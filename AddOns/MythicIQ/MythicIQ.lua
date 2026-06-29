-- MythicIQ.lua
-- Addon for bridging MythicIQ group manifests into WoW Premade Groups.
--
-- One paste field. Paste your MythicIQ output and the addon figures out the rest:
--
-- Leader:
--   * Group Finder opens.
--   * A click-to-copy "group name" (e.g. "MythicIQ 37DF1Q") is shown to paste into
--     your premade listing title.
--   * A live roster pane shows every expected player and tracks them:
--       Awaiting  ->  Applied (they showed up in your applicant list)
--                 ->  Joined  (they are in your party/raid)
--     Rows flash as their state changes.
--
-- Applicant:
--   * Group Finder opens and the group name is dropped into the search box when
--     possible (otherwise it's shown click-to-copy).
--   * You search and apply yourself.
--
-- Manifest format (pipe-delimited, percent-encoded values):
--
-- Leader:
--   MIQ1|MODE=LEADER|CODE=37DF1Q|NAME=MythicIQ%2037DF1Q|P1=Name-Realm|P2=Name-Realm
--
-- Applicant:
--   MIQ1|MODE=APPLY|CODE=37DF1Q|NAME=MythicIQ%2037DF1Q|ROLE=DAMAGER
--
-- Percent-encode reserved characters from the app side:
--   %  => %25      |  => %7C      =  => %3D      ,  => %2C      space => %20
--
-- NAME is optional; it defaults to "MythicIQ <CODE>".

local ADDON_NAME = "MythicIQ"
local MIQ = {}
_G.MythicIQLFG = MIQ

MythicIQLFGDB = MythicIQLFGDB or {}

local ICON_PATH = "Interface\\AddOns\\MythicIQ\\Media\\miq-icon.tga"

local STATE_AWAITING = "awaiting"
local STATE_APPLIED = "applied"
local STATE_JOINED = "joined"

local STATE_STYLE = {
    [STATE_AWAITING] = { dot = { 0.5, 0.5, 0.5 }, label = "Awaiting", labelColor = "ffb0b0b0" },
    [STATE_APPLIED]  = { dot = { 1.0, 0.82, 0.0 }, label = "Applied",  labelColor = "ffffd200" },
    [STATE_JOINED]   = { dot = { 0.1, 0.9, 0.2 },  label = "Joined",   labelColor = "ff33dd44" },
}

local function Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cff8b5cf6MythicIQ:|r " .. tostring(msg))
end

local function SafeCall(fn, ...)
    local ok, result = pcall(fn, ...)
    if not ok then
        return nil
    end
    return result
end

local function Trim(s)
    if not s then return "" end
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function UrlDecode(s)
    if not s then return "" end
    s = s:gsub("%%20", " ")
    s = s:gsub("%%7C", "|")
    s = s:gsub("%%3D", "=")
    s = s:gsub("%%2C", ",")
    s = s:gsub("%%25", "%%")
    return s
end

-- Canonical key for matching a "Name-Realm" against group/applicant data:
-- lowercased, whitespace stripped, fancy dashes normalized to '-'.
local function NormalizeNameRealm(name)
    if not name then return nil end
    name = Trim(name)
    name = name:gsub("%s+", "")
    name = name:gsub("–", "-")
    name = name:gsub("—", "-")
    name = string.lower(name)
    if name == "" then return nil end
    return name
end

local function SplitPipe(raw)
    local parts = {}
    for part in string.gmatch(raw or "", "([^|]+)") do
        table.insert(parts, part)
    end
    return parts
end

local function ParseManifest(raw)
    raw = Trim(raw)
    if raw == "" then
        return nil, "Paste your MythicIQ output first."
    end

    local parts = SplitPipe(raw)
    if parts[1] ~= "MIQ1" then
        return nil, "That doesn't look like MythicIQ output (expected MIQ1)."
    end

    local manifest = {
        version = "MIQ1",
        mode = nil,
        runCode = nil,
        groupName = nil,
        role = nil,
        expected = {},        -- ordered list: { key, display }
    }

    for i = 2, #parts do
        local key, value = string.match(parts[i], "^([^=]+)=(.*)$")
        if key and value then
            key = string.upper(Trim(key))
            value = UrlDecode(Trim(value))

            if key == "MODE" then
                manifest.mode = string.upper(value)
            elseif key == "CODE" then
                manifest.runCode = value
            elseif key == "NAME" then
                manifest.groupName = value
            elseif key == "ROLE" then
                manifest.role = string.upper(value)
            elseif string.match(key, "^P%d+$") then
                local normalized = NormalizeNameRealm(value)
                if normalized then
                    table.insert(manifest.expected, { key = normalized, display = value })
                end
            end
        end
    end

    if manifest.mode ~= "LEADER" and manifest.mode ~= "APPLY" then
        return nil, "Manifest MODE must be LEADER or APPLY."
    end
    if not manifest.runCode or manifest.runCode == "" then
        return nil, "Manifest is missing CODE."
    end

    if not manifest.groupName or manifest.groupName == "" then
        manifest.groupName = "MythicIQ " .. manifest.runCode
    end

    return manifest
end

-- -------------------------
-- Group / applicant scanning
-- -------------------------

local function GetGroupedKeys()
    local keys = {}
    local n = GetNumGroupMembers() or 0
    if n == 0 then
        -- Solo: still include the player (they may be the leader-to-be).
        local name = UnitName("player")
        local realm = GetNormalizedRealmName() or GetRealmName()
        if name and realm then
            local k = NormalizeNameRealm(name .. "-" .. realm)
            if k then keys[k] = true end
        end
        return keys
    end

    local prefix = IsInRaid() and "raid" or "party"
    -- party1..partyN are the OTHER members; the player is "player".
    local function add(unit)
        local name, realm = UnitName(unit)
        if not name or name == UNKNOWN then return end
        if not realm or realm == "" then
            realm = GetNormalizedRealmName() or GetRealmName()
        end
        local k = NormalizeNameRealm(name .. "-" .. (realm or ""))
        if k then keys[k] = true end
    end

    add("player")
    for i = 1, n do
        add(prefix .. i)
    end
    return keys
end

-- Returns a map of normalized-key -> applicantID for everyone currently applying.
local function GetAppliedKeys()
    local applied = {}
    if not (C_LFGList and C_LFGList.GetApplicants and C_LFGList.GetApplicantMemberInfo) then
        return applied
    end

    local applicants = C_LFGList.GetApplicants()
    if not applicants then return applied end

    for _, applicantID in ipairs(applicants) do
        local memberIndex = 1
        while true do
            local name = C_LFGList.GetApplicantMemberInfo(applicantID, memberIndex)
            if not name then break end
            local key = NormalizeNameRealm(name)
            if key then applied[key] = applicantID end
            memberIndex = memberIndex + 1
        end
    end
    return applied
end

-- -------------------------
-- Manifest lifecycle
-- -------------------------

function MIQ:GetManifest()
    return self.manifest
end

function MIQ:BuildRoster(manifest)
    local roster = {}
    for _, p in ipairs(manifest.expected) do
        table.insert(roster, {
            key = p.key,
            display = p.display,
            state = STATE_AWAITING,
        })
    end
    self.roster = roster
end

function MIQ:SetManifest(raw)
    local manifest, err = ParseManifest(raw)
    if not manifest then
        Print(err)
        if self.RefreshUI then self:RefreshUI() end
        return false
    end

    self.manifest = manifest
    MythicIQLFGDB.lastRaw = raw

    if manifest.mode == "LEADER" then
        self:BuildRoster(manifest)
        Print("Leader run " .. manifest.runCode .. " loaded. Expected players: " .. #manifest.expected)
    else
        self.roster = nil
        Print("Applicant for " .. manifest.runCode .. " loaded.")
    end

    -- Open the Group Finder for the user, then act per mode.
    self:OpenGroupFinder()
    if manifest.mode == "APPLY" then
        self:PrefillSearch(manifest.groupName)
    end

    if self.RefreshUI then self:RefreshUI() end
    if manifest.mode == "LEADER" then self:RecomputeRoster() end
    return true
end

function MIQ:ClearManifest()
    self.manifest = nil
    self.roster = nil
    MythicIQLFGDB.lastRaw = nil
    if self.RefreshUI then self:RefreshUI() end
end

-- -------------------------
-- Group Finder helpers (no protected calls — UI navigation only)
-- -------------------------

function MIQ:OpenGroupFinder()
    if PVEFrame_ShowFrame then
        SafeCall(PVEFrame_ShowFrame, "GroupFinderFrame", "LFGListPVEStub")
        return
    end
    if ToggleGroupFinder then
        SafeCall(ToggleGroupFinder)
        return
    end
    if PVEFrame_ToggleFrame then
        SafeCall(PVEFrame_ToggleFrame)
    end
end

-- Best-effort: drop the group name into the premade search box. The box only
-- exists once the search panel is built, so retry a couple of times.
function MIQ:PrefillSearch(groupName, attempt)
    attempt = attempt or 1
    local box = LFGListFrame and LFGListFrame.SearchPanel and LFGListFrame.SearchPanel.SearchBox
    if box and box.SetText then
        SafeCall(function()
            box:SetText(groupName)
            box:SetCursorPosition(box:GetNumLetters() or 0)
        end)
        Print("Search box filled with \"" .. groupName .. "\". Press search, then apply.")
        return
    end
    if attempt <= 5 then
        C_Timer.After(0.3, function() MIQ:PrefillSearch(groupName, attempt + 1) end)
    end
end

-- -------------------------
-- Roster state machine
-- -------------------------

function MIQ:RecomputeRoster()
    local roster = self.roster
    if not roster then return end

    local applied = GetAppliedKeys()
    local grouped = GetGroupedKeys()

    for _, entry in ipairs(roster) do
        local newState
        if grouped[entry.key] then
            newState = STATE_JOINED
        elseif applied[entry.key] then
            newState = STATE_APPLIED
        else
            newState = STATE_AWAITING
        end
        entry.changed = (newState ~= entry.state)
        entry.state = newState
    end

    self:RefreshRosterUI()
end

-- =========================================================================
-- UI
-- =========================================================================

local ui = CreateFrame("Frame", "MythicIQLFGFrame", UIParent, "BackdropTemplate")
ui:SetSize(440, 520)
ui:SetPoint("CENTER")
ui:SetMovable(true)
ui:EnableMouse(true)
ui:SetClampedToScreen(true)
ui:RegisterForDrag("LeftButton")
ui:SetScript("OnDragStart", ui.StartMoving)
ui:SetScript("OnDragStop", ui.StopMovingOrSizing)
ui:SetFrameStrata("HIGH")
ui:Hide()

ui:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true,
    tileSize = 32,
    edgeSize = 32,
    insets = { left = 8, right = 8, top = 8, bottom = 8 },
})

local icon = ui:CreateTexture(nil, "ARTWORK")
icon:SetSize(38, 38)
icon:SetPoint("TOPLEFT", 18, -16)
icon:SetTexture(ICON_PATH)

local title = ui:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
title:SetPoint("TOPLEFT", icon, "TOPRIGHT", 10, -2)
title:SetText("MythicIQ LFG")

local subtitle = ui:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
subtitle:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
subtitle:SetText("Paste your MythicIQ output below.")

local closeButton = CreateFrame("Button", nil, ui, "UIPanelCloseButton")
closeButton:SetPoint("TOPRIGHT", -8, -8)

-- --- Paste field (multiline) ---
local pasteBG = CreateFrame("Frame", nil, ui, "BackdropTemplate")
pasteBG:SetPoint("TOPLEFT", 18, -68)
pasteBG:SetPoint("TOPRIGHT", -18, -68)
pasteBG:SetHeight(60)
pasteBG:SetBackdrop({
    bgFile = "Interface\\ChatFrame\\ChatFrameBackground",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 12,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
})
pasteBG:SetBackdropColor(0, 0, 0, 0.6)

local pasteBox = CreateFrame("EditBox", nil, pasteBG)
pasteBox:SetMultiLine(true)
pasteBox:SetAutoFocus(false)
pasteBox:SetFontObject(ChatFontNormal)
pasteBox:SetMaxLetters(0)
pasteBox:SetPoint("TOPLEFT", 8, -6)
pasteBox:SetPoint("BOTTOMRIGHT", -8, 6)
pasteBox:SetTextInsets(0, 0, 0, 0)
pasteBox:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)

-- --- Action buttons ---
local function MakeButton(text, width, onClick)
    local button = CreateFrame("Button", nil, ui, "UIPanelButtonTemplate")
    button:SetSize(width or 120, 24)
    button:SetText(text)
    button:SetScript("OnClick", onClick)
    return button
end

local loadButton = MakeButton("Load", 110, function()
    MIQ:SetManifest(pasteBox:GetText())
    pasteBox:ClearFocus()
end)
loadButton:SetPoint("TOPLEFT", pasteBG, "BOTTOMLEFT", 0, -10)

local clearButton = MakeButton("Clear", 80, function()
    pasteBox:SetText("")
    MIQ:ClearManifest()
end)
clearButton:SetPoint("LEFT", loadButton, "RIGHT", 8, 0)

local openButton = MakeButton("Open Group Finder", 150, function()
    MIQ:OpenGroupFinder()
    local m = MIQ:GetManifest()
    if m and m.mode == "APPLY" then MIQ:PrefillSearch(m.groupName) end
end)
openButton:SetPoint("LEFT", clearButton, "RIGHT", 8, 0)

-- --- Group-name copy box (shared by both modes) ---
local nameLabel = ui:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
nameLabel:SetPoint("TOPLEFT", loadButton, "BOTTOMLEFT", 0, -16)
nameLabel:SetText("Group name:")

local copyBG = CreateFrame("Frame", nil, ui, "BackdropTemplate")
copyBG:SetPoint("TOPLEFT", nameLabel, "BOTTOMLEFT", 0, -4)
copyBG:SetPoint("TOPRIGHT", ui, "TOPRIGHT", -18, 0)
copyBG:SetHeight(28)
copyBG:SetBackdrop({
    bgFile = "Interface\\ChatFrame\\ChatFrameBackground",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 12,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
})
copyBG:SetBackdropColor(0, 0, 0, 0.6)

local copyBox = CreateFrame("EditBox", nil, copyBG)
copyBox:SetAutoFocus(false)
copyBox:SetFontObject(ChatFontNormal)
copyBox:SetPoint("TOPLEFT", 8, -2)
copyBox:SetPoint("BOTTOMRIGHT", -8, 2)
copyBox.value = ""
-- Read-only-ish: any edit snaps back, and clicking selects all for Ctrl+C.
copyBox:SetScript("OnTextChanged", function(self)
    if self:GetText() ~= self.value then
        self:SetText(self.value)
        self:HighlightText()
    end
end)
copyBox:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
copyBox:SetScript("OnMouseUp", function(self) self:SetFocus(); self:HighlightText() end)
copyBox:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
copyBox:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)

local copyHint = ui:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
copyHint:SetPoint("TOPLEFT", copyBG, "BOTTOMLEFT", 2, -3)
copyHint:SetJustifyH("LEFT")

-- --- Roster pane (leader only) ---
local rosterHeader = ui:CreateFontString(nil, "OVERLAY", "GameFontNormal")
rosterHeader:SetPoint("TOPLEFT", copyHint, "BOTTOMLEFT", -2, -10)
rosterHeader:SetText("Expected players")

local rosterBG = CreateFrame("Frame", nil, ui, "BackdropTemplate")
rosterBG:SetPoint("TOPLEFT", rosterHeader, "BOTTOMLEFT", 0, -4)
rosterBG:SetPoint("BOTTOMRIGHT", ui, "BOTTOMRIGHT", -18, 18)
rosterBG:SetBackdrop({
    bgFile = "Interface\\ChatFrame\\ChatFrameBackground",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 12,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
})
rosterBG:SetBackdropColor(0, 0, 0, 0.35)

local rosterRows = {}

local function GetRosterRow(index)
    local row = rosterRows[index]
    if row then return row end

    row = CreateFrame("Frame", nil, rosterBG)
    row:SetHeight(24)
    row:SetPoint("TOPLEFT", 8, -8 - (index - 1) * 26)
    row:SetPoint("TOPRIGHT", -8, -8 - (index - 1) * 26)

    -- Flash highlight behind the row.
    local hl = row:CreateTexture(nil, "BACKGROUND")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 1)
    hl:SetAlpha(0)
    row.hl = hl

    local fade = hl:CreateAnimationGroup()
    local a = fade:CreateAnimation("Alpha")
    a:SetFromAlpha(0.55)
    a:SetToAlpha(0)
    a:SetDuration(1.3)
    a:SetSmoothing("OUT")
    row.fade = fade

    local dot = row:CreateTexture(nil, "ARTWORK")
    dot:SetSize(12, 12)
    dot:SetPoint("LEFT", 2, 0)
    dot:SetTexture("Interface\\COMMON\\Indicator-Gray")
    row.dot = dot

    local name = row:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    name:SetPoint("LEFT", dot, "RIGHT", 8, 0)
    name:SetJustifyH("LEFT")
    row.name = name

    local state = row:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    state:SetPoint("RIGHT", -4, 0)
    state:SetJustifyH("RIGHT")
    row.stateLabel = state

    rosterRows[index] = row
    return row
end

function MIQ:RefreshRosterUI()
    local roster = self.roster
    if not roster then
        for _, row in ipairs(rosterRows) do row:Hide() end
        return
    end

    local joined = 0
    for index, entry in ipairs(roster) do
        local row = GetRosterRow(index)
        local style = STATE_STYLE[entry.state] or STATE_STYLE[STATE_AWAITING]

        row.name:SetText(entry.display)
        row.dot:SetColorTexture(style.dot[1], style.dot[2], style.dot[3], 1)
        row.stateLabel:SetText("|c" .. style.labelColor .. style.label .. "|r")

        if entry.state == STATE_JOINED then joined = joined + 1 end

        -- Flash on any state transition (different feel per state via the dot/label color).
        if entry.changed then
            row.fade:Stop()
            local c = style.dot
            row.hl:SetColorTexture(c[1], c[2], c[3], 1)
            row.fade:Play()
            entry.changed = false
        end

        row:Show()
    end

    for index = #roster + 1, #rosterRows do
        rosterRows[index]:Hide()
    end

    rosterHeader:SetText(string.format("Expected players (%d joined / %d)", joined, #roster))
end

-- --- Applicant hint (applicant only) ---
local applyHint = ui:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
applyHint:SetPoint("TOPLEFT", copyHint, "BOTTOMLEFT", -2, -10)
applyHint:SetPoint("RIGHT", ui, "RIGHT", -18, 0)
applyHint:SetJustifyH("LEFT")
applyHint:SetText("Search for the group above in the Group Finder, then apply with your role.")

-- --- Empty/help state ---
local helpText = ui:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
helpText:SetPoint("TOPLEFT", nameLabel, "TOPLEFT", 0, 0)
helpText:SetPoint("RIGHT", ui, "RIGHT", -18, 0)
helpText:SetJustifyH("LEFT")
helpText:SetText(
    "Paste the MythicIQ output you copied from the app and press Load.\n\n" ..
    "Leaders get a copyable group name and a live roster of who has applied and joined.\n" ..
    "Applicants get the group name dropped into search so they can apply."
)

function MIQ:RefreshUI()
    local manifest = self:GetManifest()

    -- Default: hide mode-specific widgets, show help.
    local function hideAll()
        nameLabel:Hide(); copyBG:Hide(); copyHint:Hide()
        rosterHeader:Hide(); rosterBG:Hide()
        applyHint:Hide()
        for _, row in ipairs(rosterRows) do row:Hide() end
    end

    if not manifest then
        hideAll()
        helpText:Show()
        subtitle:SetText("Paste your MythicIQ output below.")
        ui:SetHeight(300)
        return
    end

    helpText:Hide()
    nameLabel:Show()
    copyBG:Show()
    copyHint:Show()

    copyBox.value = manifest.groupName
    copyBox:SetText(manifest.groupName)

    if manifest.mode == "LEADER" then
        subtitle:SetText("Leader run " .. manifest.runCode .. " — paste the name into your listing.")
        nameLabel:SetText("Listing name (click to select, Ctrl+C to copy):")
        copyHint:SetText("Create your premade group and paste this as the listing title.")
        applyHint:Hide()
        rosterHeader:Show()
        rosterBG:Show()
        ui:SetHeight(520)
        self:RefreshRosterUI()
    else
        subtitle:SetText("Applicant for run " .. manifest.runCode .. ".")
        nameLabel:SetText("Group name to search (click to select, Ctrl+C to copy):")
        copyHint:SetText("In the Group Finder, search this name then apply with your role.")
        rosterHeader:Hide()
        rosterBG:Hide()
        for _, row in ipairs(rosterRows) do row:Hide() end
        applyHint:Show()
        ui:SetHeight(320)
    end
end

function MIQ:Toggle()
    if ui:IsShown() then
        ui:Hide()
    else
        ui:Show()
        self:RefreshUI()
    end
end

-- -------------------------
-- Events
-- -------------------------

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("LFG_LIST_APPLICANT_LIST_UPDATED")
eventFrame:RegisterEvent("LFG_LIST_APPLICANT_UPDATED")
eventFrame:RegisterEvent("GROUP_ROSTER_UPDATE")

eventFrame:SetScript("OnEvent", function(_, event, ...)
    if event == "ADDON_LOADED" then
        local loadedName = ...
        if loadedName == ADDON_NAME then
            MythicIQLFGDB = MythicIQLFGDB or {}
            Print("Loaded. Type /miq to open, then paste your MythicIQ output.")
        end

    elseif event == "LFG_LIST_APPLICANT_LIST_UPDATED"
        or event == "LFG_LIST_APPLICANT_UPDATED"
        or event == "GROUP_ROSTER_UPDATE" then

        local manifest = MIQ:GetManifest()
        if manifest and manifest.mode == "LEADER" and MIQ.roster then
            MIQ:RecomputeRoster()
        end
    end
end)

-- -------------------------
-- Slash commands
-- -------------------------

SLASH_MYTHICIQ1 = "/miq"
SLASH_MYTHICIQ2 = "/mythiciq"

SlashCmdList["MYTHICIQ"] = function(msg)
    msg = Trim(msg or "")

    if msg == "" then
        MIQ:Toggle()
        return
    end

    local cmd, rest = string.match(msg, "^(%S+)%s*(.*)$")
    cmd = string.lower(cmd or "")

    if cmd == "paste" then
        pasteBox:SetText(rest)
        MIQ:SetManifest(rest)
        if not ui:IsShown() then MIQ:Toggle() end
    elseif cmd == "clear" then
        pasteBox:SetText("")
        MIQ:ClearManifest()
    elseif cmd == "open" then
        MIQ:OpenGroupFinder()
    else
        Print("Commands:")
        Print("/miq           - open the panel")
        Print("/miq paste <…> - load a manifest directly")
        Print("/miq open      - open the Group Finder")
        Print("/miq clear     - clear the loaded manifest")
    end
end
