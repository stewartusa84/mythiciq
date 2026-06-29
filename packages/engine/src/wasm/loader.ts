// Environment-agnostic WASM loader. Pass raw wasm bytes; we instantiate and return
// the typed exports. The module imports nothing (raw cdylib + lol_alloc), so no
// import object is required.

export interface ParserWasmExports {
  memory: WebAssembly.Memory;

  // input buffer lifecycle
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;

  // parse + reset
  parse(ptr: number, len: number): number;
  reset(): void;
  event_count(): number;

  // hot columns
  col_ts_ptr(): number;
  col_event_type_ptr(): number;
  col_record_kind_ptr(): number;
  col_format_ptr(): number;
  col_source_guid_ptr(): number;
  col_source_name_ptr(): number;
  col_source_flags_ptr(): number;
  col_source_raid_ptr(): number;
  col_target_guid_ptr(): number;
  col_target_name_ptr(): number;
  col_target_flags_ptr(): number;
  col_target_raid_ptr(): number;
  col_spell_id_ptr(): number;
  col_spell_name_ptr(): number;
  col_spell_school_ptr(): number;
  col_amount_ptr(): number;

  // side table (per-event long-tail fields)
  side_offsets_ptr(): number;
  side_len(): number;
  side_name_ptr(): number;
  side_kind_ptr(): number;
  side_ival_ptr(): number;
  side_fval_ptr(): number;

  // intern table
  intern_count(): number;
  intern_bytes_ptr(): number;
  intern_bytes_len(): number;
  intern_offsets_ptr(): number;

  // actor table (guid id -> name id)
  actor_count(): number;
  actor_guid_ptr(): number;
  actor_name_ptr(): number;

  // spell table (numeric spell id -> name id)
  spell_count(): number;
  spell_id_ptr(): number;
  spell_name_ptr(): number;
}

export async function instantiateParser(wasm: BufferSource): Promise<ParserWasmExports> {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  return instance.exports as unknown as ParserWasmExports;
}
