#include <pebble.h>

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

  // Sizes (bytes) are fixed: past 32 KB in total the engine never grows
  // them, so they must cover the app's peak. The slot heap holds every JS
  // object and function: 32 KB stopped being enough at startup once the
  // traffic alerts were added ("Slot allocation: failed in fixed size
  // heap", seen in the SDK 4.44 emulator). The app RAM is 128 KB in all,
  // shared with the UI library and the AppMessage buffers (see `input` /
  // `output` in src/embeddedjs/main.js).
  //
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
    .slot = 49152,
    .chunk = 32768,
#ifdef PBL_DEBUG
    // Built with `pebble build --debug`: enable the xsbug JavaScript debugger.
    .flags = kModdableCreationFlagDebug,
#endif
  };
  moddable_createMachine(&cr);

  window_destroy(w);
}
