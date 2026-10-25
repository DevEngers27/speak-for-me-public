import { backendMarker } from "../functions";
import { v } from "convex/values";

export const nestedMarker = `${backendMarker}:${typeof v}`;
