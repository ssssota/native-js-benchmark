import type { Step } from "../docker.ts";
import type { Variant, Workload } from "../variants.ts";
import { nodePlan, bunPlan, denoPlan } from "./runtimes.ts";
import { perryPlan, scriptcPlan, porfforPlan, staticHermesPlan, oseoPlan } from "./native.ts";

export function compilePlan(variant: Variant, workload: Workload): Step[] {
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
  }
}
