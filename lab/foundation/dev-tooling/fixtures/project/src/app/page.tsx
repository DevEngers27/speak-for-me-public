import { api } from "@convex/_generated/api";
import { engineMarker } from "@core/engine/index";
import { alphaMarker } from "@core/scenarios/alpha/index";
import { appConfig } from "@/lib/config";

export default function Page() {
  return <main data-api={api.marker}>{[engineMarker, alphaMarker, appConfig.name].join(" ")}</main>;
}
