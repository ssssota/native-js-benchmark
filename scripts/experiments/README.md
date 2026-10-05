# Object-shape causal experiments

Existing `src/object-stable.*`, `src/object-churn.*`, `tmp.log` and saved host
measurements are left unchanged. This separate harness generates controlled
variants and reuses the existing host compiler plans, retaining LLVM IR/C.

See [the report](../../reports/object-shapes-benchmark.md) and
[frozen results](../../reports/object-shapes-study-results.json).

## Run

From the repository root, with the same installed toolchains as host benchmarks:

```sh
node scripts/experiments/object-shapes.ts --group semantics --rounds 1
node scripts/experiments/object-shapes.ts --group scaling --tools scriptc,scriptc-record,scriptc-map --rounds 5
node scripts/experiments/object-shapes.ts --group throughput --tools node,node-jitless,bun,deno,porffor,perry,perry-ts,hermes,quickjs
node scripts/experiments/object-shapes.ts --group shapes --tools node,node-jitless,bun,deno,porffor,perry,perry-ts,hermes,quickjs,scriptc-record,scriptc-map
```

Use `--cases reset-8,drain-8,keep-8` for a subset, `--rounds 5` for confirmation,
or `--output build/my-object-study` for a separate run. Run timing commands
serially. Tools are not installed or upgraded by these scripts.

Additional typed targets: `hermes-flow` (numeric indexer), `hermes-optional`
(`number | void`, with an explicit `Number` conversion after the guard),
`scriptc-optional` (`number | undefined`). Some inputs deliberately expose
unsupported or incorrect semantics. A failed checksum is recorded as failure,
never as a valid fast timing; the matrix continues after individual failures.
Inspect `status` in the result, not just the runner's exit code.

Each case/target directory contains generated input, source hash,
`experiment.json`, `result.json`, stdout and compiler output. Compilation is
reused only when the generated source hash matches; changing toolchain versions
requires a fresh output directory. Repeating a case replaces its latest result,
while timestamped `summary-*.json` retains earlier passes.

## Measurement units

- `throughput`: one operation is a complete 200,000-update workload, including
  initialization of its own fresh object array.
- `shapes`: one operation is a complete 2,000,000-named-load workload, including
  initialization. Its numbers are **not** directly comparable with throughput.
- Both use two pilot calls, an adaptive 1–50 calls/batch, two warmup and seven
  measured batches per fresh process; default three processes. `Date.now()`
  measures whole batches; actual batches can be shorter than the pilot target
  after JIT optimization. Reported median is the median of process medians.
- `scaling`: 20,000 updates, one untimed process and then fresh timed processes;
  startup included, measured with `process.hrtime.bigint()`.
- `semantics`: output validation only. Its printed durations are not a benchmark.

The `dictionary-K` name describes the verified V8 effect of deleting an initial
sentinel before stable updates. For other engines it is only a **pre-delete
control**, not a claim about internal representation. `keep-K` adds a restoration
write; it is not instruction-for-instruction identical to `drain-8`.

## Diagnostics and snapshot

Run diagnostics separately from timing:

```sh
node scripts/experiments/diagnose-object-shapes.ts
node scripts/experiments/profile-object-shapes.ts build/host-darwin-arm64/scriptc-object-stable/out build/object-shape-study-2026-09-25/scriptc-stable.sample.txt
node scripts/experiments/profile-object-shapes.ts build/object-shape-study-2026-09-25/drain-8/perry/out build/object-shape-study-2026-09-25/perry-symbols-churn.sample.txt build/object-shape-study-2026-09-25/drain-8/perry/intermediates/object-stable.js
node scripts/experiments/collect-object-shapes.ts
```

The V8 diagnostic uses internal intrinsics, not portable JS APIs. It checks
property mode/cardinality and separately traces optimization/deoptimization
across the warmup/measurement boundary for generated Node inputs.

The macOS sampler starts its **own** process, samples it for two seconds, and
terminates only that child if it is still running. With an optional Perry source
argument it compiles a separate `out-symbols` using `PERRY_KEEP_SYMBOLS=1`;
the timed executable is untouched. Sampling results are diagnostic, not timings.
Profiles may include startup/GC and are not precise attribution percentages.

The collector freezes latest per-case results, versions, raw batches, V8 probes,
deopt events and profile top-of-stack summaries into the report JSON. Paths in
that snapshot use `<repo>` to avoid depending on one checkout location.

## Oseo MIR/C study

The separate Oseo study runs hello, primes, json, object-stable/churn, a typed
addition probe and a primes let/var control. It retains plain and measured
inputs, MIR, C, binary/source hashes, actual build requests and three fresh
processes of timings. Standard targets preserve upstream settings; generated-C
O2 and no-sanitizers targets are experimental controls.

See [the Oseo report](../../reports/oseo-benchmark.md) and
[frozen results](../../reports/oseo-study-results.json).

```sh
mise exec -- node scripts/experiments/oseo-study.ts --phase compile
mise exec -- node scripts/experiments/oseo-study.ts --phase measure
mise exec -- node scripts/experiments/oseo-probes.ts
```

Use `--output build/my-oseo-study` and `--rounds 3` for a separate timing run,
or `--targets node` to measure only a target. Run timing commands serially and
run diagnostics afterwards. `--phase inspect` recomputes aggregate results and
static MIR/C metrics without rerunning workloads. The probes accept the study
directory as their positional argument; they enable observation in separate
binaries and validate shape caches, numeric fallback and real deletion.

The report lists four sampling commands using `profile-object-shapes.ts`.
After collecting those profiles, run
`node scripts/experiments/collect-oseo-study.ts [study-directory]` to freeze the
results; the collector rejects incomplete measurements or failed probes.

## Native compiler comparison

After preparing the Oseo study, run the matching Porffor, Static Hermes, Perry
and scriptc comparison serially. It also measures scriptc's explicit C backend,
typed primes, and the saved Oseo/Node artifacts in the same timing pass. Object
timings are skipped when the minimal reference persistence probe fails.

```sh
mise exec -- node scripts/experiments/native-comparison.ts --phase compile
mise exec -- node scripts/experiments/native-comparison.ts --phase measure
mise exec -- node scripts/experiments/collect-native-comparison.ts
```

`--targets scriptc-c,scriptc-ts` selects compilation or measurement targets;
`--output build/my-native-comparison` retains results in a separate tree.
`--phase inspect` only reaggregates results. The baseline artifacts currently
come from `build/oseo-study-2026-10-05`; this dependency is explicit in the script.
The collector checks checksums, all three rounds and unchanged artifact hashes.
See [the comparison report](../../reports/native-comparison.md) and
[frozen results](../../reports/native-comparison-results.json).
