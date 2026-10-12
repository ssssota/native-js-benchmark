import type { Step } from "../docker.ts";
import { requireWorkload, type Variant, type Workload } from "../variants.ts";
import { nodePlan, bunPlan, denoPlan } from "./runtimes.ts";
import {
  perryPlan,
  scriptcPlan,
  porfforPlan,
  staticHermesPlan,
  oseoPlan,
  spinelPlan,
  lythonPlan,
} from "./native.ts";

export function compilePlan(variant: Variant, workload: Workload): Step[] {
  requireWorkload(variant.tool, workload);
  switch (variant.tool) {
    case "node":
      return nodePlan(variant.cache, workload);
    case "bun":
      return bunPlan(variant.cache, workload);
    case "deno":
      return denoPlan(variant, workload);
    case "perry":
      return perryPlan(variant, workload);
    case "scriptc":
      return scriptcPlan(variant, workload);
    case "porffor":
      return porfforPlan(workload);
    case "static_hermes":
      return staticHermesPlan(variant, workload);
    case "oseo":
      return oseoPlan(variant, workload);
    case "spinel":
      return spinelPlan(workload);
    case "lython":
      return lythonPlan(workload);
    case "cpython":
    case "cruby":
      throw new Error(`${variant.tool} executes source; use run or bench --execution source.`);
  }
}
