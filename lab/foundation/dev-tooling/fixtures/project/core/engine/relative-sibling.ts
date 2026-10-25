import { engineMarker } from "./index";
import { z } from "zod";

export const siblingMarker = `${engineMarker}:${typeof z}`;
