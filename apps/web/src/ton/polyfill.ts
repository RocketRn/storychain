// @ton/core relies on Node's Buffer, which browsers lack. Import this module FIRST in any TON module.
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
