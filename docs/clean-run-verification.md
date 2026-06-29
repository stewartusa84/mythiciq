# MythicIQ Run Verification Philosophy

MythicIQ does not trust client-generated scores, clean run claims, or reputation outcomes. Clients submit a compact, signed set of observed run evidence derived from the combat log. This evidence is intended to describe what happened during the run without requiring the full combat log to be uploaded by default.

The server is responsible for three separate determinations:

1. Whether the submitted evidence was properly signed by MythicIQ and has not been casually modified in transit or altered by outside tools before submission.
2. Whether the submitted evidence reasonably represents a real Mythic+ run with a coherent timeline, valid roster, plausible encounter progression, and internally consistent events.
3. Which characters in the run qualify for various run credits based on the submitted evidence, current ruleset, and role-specific expectations.

The submitted evidence includes run lifecycle events such as challenge start, challenge end, dungeon, key level, duration, completion status, and party roster. It also includes encounter milestones, boss engagements and kills, player deaths and killing blows, battle resurrection usage, successful interrupts, dangerous interruptible casts that completed, dangerous interruptible casts that completed while one or more players had an interrupt available, significant damage events, and meaningful dispellable effects that resulted in major damage or death. As MythicIQ's curated mechanic library grows, additional mechanic-specific findings may also be included.

A clean run is not awarded simply because no failures were reported. Clean run credit requires sufficient evidence coverage and must be derived server-side. The submission must demonstrate that the relevant encounters, mechanics, dangerous casts, deaths, interrupts, and role expectations were observed well enough to evaluate the run. The absence of failures is only meaningful when accompanied by evidence showing that those failures could have been detected.

A character qualifies for clean run credit when their observed performance is at or below the allowed infraction threshold for the active curated ruleset. Infractions may include failures from the curated mechanic list, avoidable deaths, critical avoidable damage, failed dispel responsibilities, missed important interrupts, or other role-specific failures. The threshold may vary by dungeon, key range, season, role, and rules version.

Clean run evaluation also includes reasonable class and role resource usage. This does not require perfect play, but it does require that a player used important tools in a reasonable way for their role when the run context called for them. Examples include defensive usage when large incoming damage was predictable, reasonable mitigation coverage for tanks, interrupting important casts for DPS and tanks, and using healer cooldowns or emergency tools when there was reasonable time and opportunity to save players. These expectations are defined by curated role/spec rules and should be versioned alongside mechanic rules.

Run verification is therefore based on signed evidence, evidence coverage, and server-side reasonability checks rather than trust in the client. The server evaluates whether the submission tells a complete, internally consistent, and plausible story of the run. If the evidence is sufficient and coherent, the server may award run credit. If the evidence is incomplete, inconsistent, suspicious, statistically unlikely, or conflicts with other submissions, the run may be marked as low-confidence, require additional verification, or request submission of the relevant full log segment.

As MythicIQ adoption grows, multiple submissions from members of the same run can be used to corroborate evidence and increase confidence. However, corroboration is not required for normal credit. Lack of corroboration reduces certainty, not eligibility. The system is designed to reward honest participation while making fabricated submissions increasingly difficult to construct, detectably incomplete, statistically implausible, or inconsistent with expected run evidence.

In short, clients submit signed observations, the server validates whether those observations reasonably represent a real run, and reputation is awarded only when sufficient evidence supports the claimed outcome for each character.
