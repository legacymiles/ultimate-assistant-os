# The owner's computer

The PC everything local runs on (GPU tools, ComfyUI/WanGP, dev servers). Check these limits
before suggesting a local model, a render job or an upgrade.

| Part | Spec |
|---|---|
| Laptop | Lenovo LOQ 15ARP9 (Type 83JC) |
| OS | Windows 11 Home |
| CPU | AMD Ryzen 5 7235HS, 4 cores / 8 threads |
| GPU | NVIDIA RTX 3050 Laptop GPU, 6 GB VRAM |
| RAM | 12 GB (2 × DDR5 SODIMM slots, probably 8 GB + 4 GB) |
| Storage | 512 GB Micron NVMe SSD |
| BIOS | PQCN06WW |

## What that means in practice

- **6 GB VRAM** is the hard ceiling for local AI: small/quantized models only (e.g. Wan 2.1 1.3B,
  quantized Wan 2.2). 14B+ video models do not fit; send those to a cloud GPU.
- **12 GB RAM** is tight: large models that spill out of VRAM slow down or crash.

## Planned RAM upgrade (2026-09-21)

Replace both sticks with a 32 GB kit (2 × 16 GB DDR5 SODIMM, 262-pin). The Ryzen 5 7235HS runs
memory at DDR5-4800, so 5600 MHz kits work and just run at 4800. Candidates:

- Crucial CT2K16G56C46S5 — safest pick
- Kingston FURY Impact KF556S40IBK2-32
- Timetec 32 GB DDR5-5600 CL46 kit — fine if it is noticeably cheaper
