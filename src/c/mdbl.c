#include <pebble.h>

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

  // Firmware-managed defaults (chunk/slot/stack left at 0) exhaust the
  // chunk heap on real hardware -- confirmed via `fxAbort memory full`
  // ("Chunk allocation: failed for N bytes") after saving tracked stops in
  // config. A prior attempt that set only .chunk/.slot (leaving .stack at
  // 0) failed to even launch the app, suggesting .stack must be set
  // explicitly alongside chunk/slot rather than left to derive from
  // whatever's left over. These values match another real Alloy/Pebble
  // project (camr0/SimpleRoundWatchFace) that hit the identical crash.
  ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .stack = 6144,
    .slot = 32768,
    .chunk = 32768,
#ifdef PBL_DEBUG
    // Built with `pebble build --debug`: enable the xsbug JavaScript debugger.
    .flags = kModdableCreationFlagDebug,
#endif
  };
  moddable_createMachine(&cr);

  window_destroy(w);
}
