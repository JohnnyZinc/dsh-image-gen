/** Minimal ambient type for the host-provided `sharp` native module (loaded at runtime). */
declare module 'sharp' {
  export interface Sharp {
    png(): Sharp
    toBuffer(): Promise<Buffer>
  }
  function sharp(input: Uint8Array): Sharp
  export default sharp
}
