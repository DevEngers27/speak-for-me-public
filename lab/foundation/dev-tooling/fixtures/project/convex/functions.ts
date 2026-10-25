import { engineMarker } from "@core/engine/index";
import { alphaMarker } from "../core/scenarios/alpha/index";
import { betaMarker } from "@core/scenarios/beta/index";
import { query } from "./_generated/server";

export const backendMarker = "backend" as const;
export const markers = [engineMarker, alphaMarker, betaMarker, typeof query];
