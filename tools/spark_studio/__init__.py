"""spark_studio — video in, Gaussian splat out, on this machine.

The reconstruction the web app has always assumed exists. `lib/studio.ts` is a
client for a studio server; that server was a 125 GB ComfyUI checkout on someone
else's Mac and was never in this repository. This is a small, self-contained
replacement that owes nothing to ComfyUI.

THREE STAGES, AND THEY ARE NOT THE SAME PROBLEM:

    video.mp4 --frames--> images --poses--> COLMAP triple --train--> splat.ply
              (ffmpeg)           (pycolmap)               (brush-cli)

Stage 2 works out WHERE THE CAMERA WAS for each frame. It produces no model of
the scene — just poses and a sparse dust of tie points. Stage 3 is the one that
makes the splat. Conflating them is the single most common misunderstanding
about this pipeline, so the module boundaries keep them apart on purpose.

WHAT THIS REFUSES TO DO IS THE POINT. Every stage can fail for real reasons —
no ffmpeg, no wheel, footage with no parallax, a GPU that cannot compile the
shader — and each failure is a NAMED state with a sentence a person can act on.
Nothing here reports that a splat was made unless a .ply is on disk.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
