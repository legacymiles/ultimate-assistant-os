# The owner's computer

The PC everything local runs on (GPU tools, ComfyUI/WanGP, dev servers). Check these limits
before suggesting a local model, a render job or an upgrade.

| Part | Spec |
|---|---|
| Laptop | Lenovo LOQ 15ARP9 (Type 83JC) |
| OS | Windows 11 Home |
| CPU | AMD Ryzen 5 7235HS, 4 cores / 8 threads |
| GPU | NVIDIA RTX 3050 Laptop GPU, 6 GB VRAM |
| RAM | 32 GB DDR5 (2 × 16 GB Corsair Vengeance CMSX16GX5M1A5600C48, dual channel, runs at 4800) |
| Storage | 512 GB Micron NVMe SSD |
| BIOS | PQCN06WW |

## What that means in practice

- **6 GB VRAM** is the hard ceiling for local AI: small/quantized models only (e.g. Wan 2.1 1.3B,
  quantized Wan 2.2). 14B+ video models do not fit; send those to a cloud GPU.
- **32 GB RAM** (upgraded 2026-09-21 from 12 GB) gives room for models that offload from VRAM to
  system RAM (e.g. WanGP int8 models, ComfyUI low-VRAM mode). Offloading is still slower than VRAM.
