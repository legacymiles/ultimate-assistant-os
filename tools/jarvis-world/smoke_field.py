"""
Smoke for the heart of Jarvis's galaxy ball, without a fluid solver.

Use this when Blender's Mantaflow can't run (the pip `bpy` module ships it
broken); with a full Blender install, prefer bake_smoke.py. Both write the
same file: a 64³ uint8 density grid in (z, y, x) order, domain [-2, 2]³,
Blender Z-up — exactly what WorldField.tsx ray-marches.

How: tracer particles leave the core and are carried by a velocity field
made of (a) a gentle outward push, (b) a swirl round a tilted axis and
(c) divergence-free curl noise — the standard trick for smoke-like motion
without solving the fluid. Their trails are splatted into the grid, blurred
a little and normalised, so the result is wispy, twisted, layered smoke
rather than a soft ball.

Run (numpy only):
  python tools/jarvis-world/smoke_field.py --out public/jarvis/smoke_64.bin [--seed 7]
"""

import argparse
import os

import numpy as np

N = 64
HALF = 2.0  # domain is [-HALF, HALF]³


def smooth_noise(rng, n, sigma):
    """Gaussian-smoothed white noise on an n³ periodic grid (via FFT)."""
    field = rng.standard_normal((n, n, n)).astype(np.float32)
    k = np.fft.fftfreq(n)
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    filt = np.exp(-0.5 * (kx**2 + ky**2 + kz**2) * (2 * np.pi * sigma) ** 2)
    out = np.real(np.fft.ifftn(np.fft.fftn(field) * filt)).astype(np.float32)
    return out / (out.std() + 1e-6)


def curl(ax, ay, az, h):
    """Curl of the vector potential (ax, ay, az) on a grid with spacing h, axes (x, y, z)."""
    day_dz = np.gradient(ay, h, axis=2)
    daz_dy = np.gradient(az, h, axis=1)
    dax_dz = np.gradient(ax, h, axis=2)
    daz_dx = np.gradient(az, h, axis=0)
    day_dx = np.gradient(ay, h, axis=0)
    dax_dy = np.gradient(ax, h, axis=1)
    return daz_dy - day_dz, dax_dz - daz_dx, day_dx - dax_dy


def sample(field, p):
    """Trilinear sample of an (n, n, n) field (axes x, y, z) at points p in domain coords."""
    n = field.shape[0]
    g = (p + HALF) / (2 * HALF) * (n - 1)
    g = np.clip(g, 0, n - 1.001)
    i = np.floor(g).astype(np.int32)
    f = g - i
    x0, y0, z0 = i[:, 0], i[:, 1], i[:, 2]
    x1, y1, z1 = x0 + 1, y0 + 1, z0 + 1
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    c = 0.0
    for xi, wx in ((x0, 1 - fx), (x1, fx)):
        for yi, wy in ((y0, 1 - fy), (y1, fy)):
            for zi, wz in ((z0, 1 - fz), (z1, fz)):
                c = c + field[xi, yi, zi] * wx * wy * wz
    return c


def splat(grid, p, w):
    """Trilinear splat of weights w at points p into grid (axes x, y, z)."""
    n = grid.shape[0]
    g = (p + HALF) / (2 * HALF) * (n - 1)
    ok = np.all((g >= 0) & (g < n - 1), axis=1)
    g, w = g[ok], w[ok]
    i = np.floor(g).astype(np.int32)
    f = g - i
    for dx in (0, 1):
        wx = f[:, 0] if dx else 1 - f[:, 0]
        for dy in (0, 1):
            wy = f[:, 1] if dy else 1 - f[:, 1]
            for dz in (0, 1):
                wz = f[:, 2] if dz else 1 - f[:, 2]
                np.add.at(grid, (i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz), w * wx * wy * wz)


def blur(grid, sigma):
    n = grid.shape[0]
    k = np.fft.fftfreq(n)
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    filt = np.exp(-0.5 * (kx**2 + ky**2 + kz**2) * (2 * np.pi * sigma) ** 2)
    return np.real(np.fft.ifftn(np.fft.fftn(grid) * filt))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--particles", type=int, default=90000)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)

    # Curl noise at two scales: big lazy rolls plus finer tearing.
    h = 2 * HALF / (N - 1)
    pots = [smooth_noise(rng, N, 4.5) + 0.55 * smooth_noise(rng, N, 2.0) + 0.3 * smooth_noise(rng, N, 1.1) for _ in range(3)]
    cx, cy, cz = curl(*pots, h)
    scale = 1.0 / (np.sqrt(cx**2 + cy**2 + cz**2).mean() + 1e-6)
    cx, cy, cz = cx * scale, cy * scale, cz * scale

    axis = np.array([0.32, -0.21, 0.92])
    axis /= np.linalg.norm(axis)

    # Tracers leave the core in bursts, so the smoke has layers, not a single shell.
    n = a.particles
    d = rng.standard_normal((n, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    p = d * rng.uniform(0.05, 0.3, (n, 1))
    age0 = rng.integers(0, 60, n)  # staggered starts
    grid = np.zeros((N, N, N), dtype=np.float64)

    steps, dt = 120, 0.03
    for s in range(steps):
        live = age0 <= s
        q = p[live]
        r = np.linalg.norm(q, axis=1, keepdims=True) + 1e-6
        outward = q / r * (0.85 / (0.5 + r))
        swirl = np.cross(axis, q) * (0.9 / (0.5 + r))
        turb = np.stack([sample(cx, q), sample(cy, q), sample(cz, q)], axis=1) * 1.15
        q = q + (outward + swirl + turb) * dt
        p[live] = q
        # Trail: lay down density as they go, fading with distance from the core.
        if s % 2 == 0:
            rr = np.linalg.norm(q, axis=1)
            w = np.exp(-((rr / 1.75) ** 4))
            splat(grid, q, w)

    grid = blur(grid, 0.6)
    # Soft sphere: nothing reaches the domain walls.
    ax = np.linspace(-HALF, HALF, N)
    X, Y, Z = np.meshgrid(ax, ax, ax, indexing="ij")
    R = np.sqrt(X**2 + Y**2 + Z**2)
    grid *= np.clip(1.0 - (R / 1.9) ** 6, 0, 1)

    grid /= max(np.percentile(grid, 99.6), 1e-9)
    grid = np.clip(grid, 0, 1) ** 0.75
    vol = np.transpose(grid, (2, 1, 0))  # (x, y, z) → (z, y, x), x fastest
    out = (vol * 255).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out.tofile(a.out)
    print("SMOKE", {"bytes": out.size, "filled": round(float((out > 12).mean()), 3), "max": int(out.max())})


main()
