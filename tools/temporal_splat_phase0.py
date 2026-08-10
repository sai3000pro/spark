#!/usr/bin/env python3
"""
Phase-0 temporal-splat feasibility test (single-camera, M5 Pro, Metal/CPU only).

Question being tested: can we take two independently-generated Gaussian splats
(as our TripoSplat pipeline produces per frame) and synthesize smooth in-between
frames on this hardware -- and what actually blocks it?

We deliberately use REAL splats from ComfyUI/output. They are static-scene
training checkpoints (different Gaussian counts, no correspondence) which is
exactly the pathological case per-frame generative splats create: no shared
identity between frames. This measures both the mechanics AND the core blocker.
"""
import sys, time, resource
import numpy as np

def read_ply(path):
    with open(path, "rb") as f:
        assert f.readline().strip() == b"ply"
        fmt = f.readline().strip()
        assert b"binary_little_endian" in fmt, fmt
        props = []
        count = None
        while True:
            line = f.readline().strip()
            if line.startswith(b"element vertex"):
                count = int(line.split()[-1])
            elif line.startswith(b"property float"):
                props.append(line.split()[-1].decode())
            elif line == b"end_header":
                break
        dtype = np.dtype([(p, "<f4") for p in props])
        data = np.fromfile(f, dtype=dtype, count=count)
    return data, props

def xyz(data):
    return np.stack([data["x"], data["y"], data["z"]], axis=1).astype(np.float32)

def nn_correspondence(A, B, block=1024):
    """For each row in A, index of nearest row in B (Euclidean on xyz). Chunked."""
    B2 = (B * B).sum(1)                      # |b|^2
    idx = np.empty(len(A), dtype=np.int64)
    for i in range(0, len(A), block):
        a = A[i:i+block]
        # ||a-b||^2 = |a|^2 + |b|^2 - 2 a.b   (|a|^2 constant per row -> ignore for argmin)
        d = B2[None, :] - 2.0 * (a @ B.T)
        idx[i:i+block] = d.argmin(1)
    return idx

def peak_mb():
    # ru_maxrss is bytes on macOS
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6

def main():
    fa, fb = sys.argv[1], sys.argv[2]
    t0 = time.time()
    A, props = read_ply(fa)
    B, _ = read_ply(fb)
    t_load = time.time() - t0
    print(f"[load]  A={len(A):>7} gaussians   B={len(B):>7} gaussians   ({t_load:.2f}s, {len(props)} props)")

    if len(A) == len(B):
        print("[corr]  equal counts -> could try index-order interp (still wrong without shared identity)")
    else:
        print(f"[corr]  UNEQUAL counts ({len(A)} vs {len(B)}) -> naive per-index interpolation is IMPOSSIBLE.")
        print("        This is the core blocker: independent per-frame splats share no Gaussian identity.")

    Axyz, Bxyz = xyz(A), xyz(B)
    t0 = time.time()
    idx = nn_correspondence(Axyz, Bxyz)      # warp A onto its nearest neighbours in B
    t_nn = time.time() - t0
    match = Bxyz[idx]
    drift = np.linalg.norm(match - Axyz, axis=1)
    print(f"[warp]  NN correspondence A->B built in {t_nn:.2f}s")
    print(f"        NN distance  median={np.median(drift):.4f}  p90={np.percentile(drift,90):.4f}  max={drift.max():.4f}")
    print(f"        (large/variable NN distance = correspondence is unreliable -> visible warping artifacts)")

    # Synthesize in-between frames by interpolating ALL attributes A -> B[idx]
    Bmatch = B[idx]
    out_frames = [0.25, 0.5, 0.75]
    t0 = time.time()
    made = []
    for t in out_frames:
        frame = np.empty(len(A), dtype=A.dtype)
        for p in props:
            frame[p] = (1 - t) * A[p] + t * Bmatch[p]
        made.append((t, frame))
    t_interp = time.time() - t0
    print(f"[interp] synthesized {len(out_frames)} in-between frames in {t_interp:.2f}s "
          f"({len(A)*len(props)/max(t_interp,1e-9)/1e6:.0f}M attr-lerps/s)")

    # Write one out to prove round-trip export works
    tval, frame = made[1]
    outpath = "/tmp/temporal_phase0_t50.ply"
    with open(outpath, "wb") as f:
        f.write(b"ply\nformat binary_little_endian 1.0\n")
        f.write(f"element vertex {len(frame)}\n".encode())
        for p in props:
            f.write(f"property float {p}\n".encode())
        f.write(b"end_header\n")
        frame.tofile(f)
    print(f"[export] wrote midpoint frame -> {outpath}  ({len(frame)} gaussians)")
    print(f"[perf]  total wall {time.time()-t0+t_load+t_nn+t_interp:.2f}s   peak RAM {peak_mb():.0f} MB")

if __name__ == "__main__":
    main()
