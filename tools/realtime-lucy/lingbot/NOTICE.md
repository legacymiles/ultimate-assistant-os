# NOTICE — modifications to lingbot-world-v2

Upstream: https://github.com/robbyant/lingbot-world-v2 @ 1895d300d8ac936401689b26389f51cbd36530eb (2026-09-10), CC BY-NC-SA 4.0.
This folder is a code-only copy (paper, teaser, examples 00-02/04/05 dropped; examples/03 kept for the default intrinsics).
New file: wan/streaming.py. Modified files and the exact diff (also under CC BY-NC-SA 4.0):

```diff
diff -ru '--exclude=__pycache__' '--exclude=streaming.py' a/wan/image2video.py b/wan/image2video.py
--- a/wan/image2video.py	2026-09-14 22:11:17.627760800 -0400
+++ b/wan/image2video.py	2026-09-14 22:25:13.865701800 -0400
@@ -123,13 +123,73 @@
     return kwargs
 
 
+def _safetensors_files(dit_dir):
+    """Shard files of a (possibly sharded) safetensors dump, in index order."""
+    for index_name in (
+            "model.safetensors.index.json",
+            "diffusion_pytorch_model.safetensors.index.json",
+    ):
+        index_path = os.path.join(dit_dir, index_name)
+        if os.path.isfile(index_path):
+            with open(index_path) as f:
+                index = json.load(f)
+            return [os.path.join(dit_dir, s)
+                    for s in sorted(set(index["weight_map"].values()))]
+    for single_name in (
+            "model.safetensors",
+            "diffusion_pytorch_model.safetensors",
+    ):
+        single_path = os.path.join(dit_dir, single_name)
+        if os.path.isfile(single_path):
+            return [single_path]
+    raise FileNotFoundError(
+        f"No safetensors weights found in {dit_dir}. Expected a sharded "
+        "index (model.safetensors.index.json) or a single model.safetensors."
+    )
+
+
+def _load_dit_low_mem(model_cls, dit_dir, config, extra, torch_dtype, device):
+    """realtime-lucy: build the DiT on the meta device and stream every
+    tensor from the safetensors shards straight to `device` in `torch_dtype`.
+
+    The upstream path materialises the whole fp32 state dict in RAM (6.9 GB
+    for the 1.3B model, ~30 GB for 14B) before copying it into the module;
+    this keeps peak host memory at one tensor (~55 MB) and lands the weights
+    on the GPU already in bf16.
+    """
+    from safetensors import safe_open
+
+    with torch.device("meta"):
+        model = model_cls(**_dit_kwargs_from_config(config, extra))
+    state = {}
+    for shard in _safetensors_files(dit_dir):
+        with safe_open(shard, framework="pt", device="cpu") as f:
+            for key in f.keys():
+                state[key] = f.get_tensor(key).to(torch_dtype).to(device)
+    missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
+    if missing:
+        logging.warning(f"Missing keys when loading DiT: {missing}")
+    if unexpected:
+        logging.warning(f"Unexpected keys when loading DiT: {unexpected}")
+    # Anything the state dict did not cover is still a meta tensor. The
+    # only such attribute in WanModelFast is the RoPE table, rebuilt on CPU
+    # by _build_freqs; a stray parameter here would mean a checkpoint mismatch.
+    for name, p in model.named_parameters():
+        if p.device.type == "meta":
+            raise RuntimeError(f"DiT parameter {name} not found in checkpoint")
+    return model
+
+
 def load_dit_model(model_cls, checkpoint_dir, subfolder, config, torch_dtype,
-                   extra=None):
+                   extra=None, low_mem=False, device=None):
     """Load a DiT from ``transformers/`` or the checkpoint root.
 
     Uses ``from_pretrained`` when ``config.json`` is present. Otherwise builds
     the module from the task EasyDict and loads sharded safetensors — the
     layout of the current 1.3B Hugging Face upload.
+
+    low_mem (realtime-lucy): stream the safetensors tensors one by one onto
+    `device` instead of staging the full state dict in host RAM.
     """
     extra = extra or {}
     dit_dir = _resolve_dit_dir(checkpoint_dir, subfolder)
@@ -142,6 +202,9 @@
         f"config.json not found in {dit_dir}; building {model_cls.__name__} "
         "from the task config and loading safetensors weights."
     )
+    if low_mem:
+        return _load_dit_low_mem(model_cls, dit_dir, config, extra,
+                                 torch_dtype, device or torch.device("cuda"))
     model = model_cls(**_dit_kwargs_from_config(config, extra))
     state = _load_safetensors_state_dict(dit_dir)
     missing, unexpected = model.load_state_dict(state, strict=False)
@@ -171,10 +234,21 @@
         sink_size=0,
         infer_mode="causal_fast",
         assets_dir=None,
+        low_mem=False,
+        vae_dtype=torch.float32,
     ):
         r"""
         Initializes the image-to-video generation model components.
 
+        realtime-lucy additions:
+            low_mem (`bool`): memory-map the T5 encoder and run it block by
+                block on the GPU, and stream the DiT weights to the GPU tensor
+                by tensor. Lets the 1.3B model run on an 6-8 GB GPU in a
+                12-16 GB laptop. Implies t5_cpu-style behaviour (T5 is never
+                resident on the GPU).
+            vae_dtype (`torch.dtype`): dtype of the VAE (fp32 upstream;
+                bf16 halves its memory and roughly doubles decode speed).
+
         Args:
             infer_mode (`str`, *optional*, defaults to "causal_fast"):
                 Inference mode. "causal_fast" uses the distilled few-step
@@ -229,6 +303,9 @@
             self.init_on_cpu = False
 
         shard_fn = partial(shard_model, device_id=device_id)
+        self.low_mem = low_mem
+        if low_mem:
+            self.t5_cpu = True
         self.text_encoder = T5EncoderModel(
             text_len=config.text_len,
             dtype=config.t5_dtype,
@@ -238,6 +315,8 @@
             tokenizer_path=_resolve_asset_path(
                 config.t5_tokenizer, checkpoint_dir, assets_dir),
             shard_fn=shard_fn if t5_fsdp else None,
+            low_mem=low_mem,
+            compute_device=self.device,
         )
 
         self.vae_stride = config.vae_stride
@@ -245,6 +324,7 @@
         self.vae = Wan2_1_VAE(
             vae_pth=_resolve_asset_path(
                 config.vae_checkpoint, checkpoint_dir, assets_dir),
+            dtype=vae_dtype,
             device=self.device)
 
         if self.infer_mode == "causal_fast":
@@ -257,6 +337,8 @@
                 extra=dict(
                     local_attn_size=self.local_attn_size,
                     sink_size=self.sink_size),
+                low_mem=low_mem,
+                device=self.device,
             )
         else:
             self.model = load_dit_model(
@@ -302,6 +384,46 @@
         """Drop all cached T5 prompt embeddings. Frees ~4 MB per entry."""
         self._t5_cache.clear()
 
+    # ------------------------------------------------------------------
+    # realtime-lucy: prompt encoding and the streaming entry point.
+    # ------------------------------------------------------------------
+
+    def encode_prompt(self, input_prompt, offload_model=False, disk_cache_dir=None):
+        """T5-encode one prompt, through the in-memory cache and an optional
+        on-disk cache (so a low_mem host pays the ~10-20 s block-streamed
+        encode once per prompt, ever). Returns the same list `generate()` uses."""
+        cache_key = hashlib.sha256(input_prompt.encode('utf-8')).hexdigest()
+        if cache_key in self._t5_cache:
+            return self._t5_cache[cache_key]
+        disk_path = None
+        if disk_cache_dir:
+            os.makedirs(disk_cache_dir, exist_ok=True)
+            disk_path = os.path.join(disk_cache_dir, f"{cache_key}.pt")
+            if os.path.isfile(disk_path):
+                context = [t.to(self.device) for t in torch.load(disk_path, map_location='cpu')]
+                self._t5_cache[cache_key] = context
+                return context
+        if self.low_mem:
+            context = self.text_encoder([input_prompt], self.device)
+        elif not self.t5_cpu:
+            self.text_encoder.model.to(self.device)
+            context = self.text_encoder([input_prompt], self.device)
+            if offload_model:
+                self.text_encoder.model.cpu()
+        else:
+            context = self.text_encoder([input_prompt], torch.device('cpu'))
+            context = [t.to(self.device) for t in context]
+        self._t5_cache[cache_key] = context
+        if disk_path:
+            torch.save([t.cpu() for t in context], disk_path)
+        return context
+
+    def open_stream(self, **kwargs):
+        """Open a live causal stream: webcam frames in, generated frames out,
+        KV cache and VAE state carried across chunks. See wan/streaming.py."""
+        from .streaming import CausalStream
+        return CausalStream(self, **kwargs)
+
     def prewarm(
         self,
         img,
diff -ru '--exclude=__pycache__' '--exclude=streaming.py' a/wan/modules/model_fast.py b/wan/modules/model_fast.py
--- a/wan/modules/model_fast.py	2026-09-14 22:11:17.634790300 -0400
+++ b/wan/modules/model_fast.py	2026-09-14 22:23:28.256534700 -0400
@@ -204,8 +204,10 @@
             k = self.norm_k(self.k(context)).view(b, -1, n, d)
             v = self.v(context).view(b, -1, n, d)
 
-        # compute attention
-        x = flash_attention(q, k, v, k_lens=context_lens)
+        # compute attention. `attention` falls back to PyTorch SDPA when
+        # flash_attn is not installed (Windows / consumer GPUs); the upstream
+        # code called flash_attention() directly here and hard-asserted on it.
+        x = attention(q, k, v, k_lens=context_lens)
 
         # output
         x = x.flatten(2)
@@ -471,17 +473,36 @@
 
         # buffers (don't use register_buffer otherwise dtype will be changed in to())
         assert (dim % num_heads) == 0 and (dim // num_heads) % 2 == 0
-        d = dim // num_heads
-        self.freqs = torch.cat([
-            rope_params(1024, d - 4 * (d // 6)),
-            rope_params(1024, 2 * (d // 6)),
-            rope_params(1024, 2 * (d // 6))
-        ],
-            dim=1)
+        self.rope_max_frames = 1024
+        self.freqs = self._build_freqs(self.rope_max_frames)
 
         # initialize weights
         self.init_weights()
 
+    def _build_freqs(self, max_frames):
+        """RoPE tables for up to `max_frames` latent frames (and 1024 rows /
+        cols). Always built on the CPU so that a model constructed under a
+        `torch.device('meta')` context (low-memory loading) still gets real
+        tables; forward() moves them to the model's device on first use."""
+        d = self.dim // self.num_heads
+        spatial = max(1024, max_frames)
+        with torch.device('cpu'):
+            return torch.cat([
+                rope_params(max_frames, d - 4 * (d // 6)),
+                rope_params(spatial, 2 * (d // 6)),
+                rope_params(spatial, 2 * (d // 6))
+            ], dim=1)
+
+    def extend_rope(self, max_frames):
+        """Grow the temporal RoPE table so a stream can run past 1024 latent
+        frames (~4 minutes at 16 fps) without re-anchoring. Rows beyond the
+        training horizon are extrapolated positions: the rolling KV window
+        keeps relative offsets small for everything except the sink frames."""
+        if max_frames <= self.rope_max_frames:
+            return
+        self.rope_max_frames = int(max_frames)
+        self.freqs = self._build_freqs(self.rope_max_frames)
+
     def forward(
         self,
         x,
diff -ru '--exclude=__pycache__' '--exclude=streaming.py' a/wan/modules/t5.py b/wan/modules/t5.py
--- a/wan/modules/t5.py	2026-09-14 22:11:17.635807100 -0400
+++ b/wan/modules/t5.py	2026-09-14 22:24:32.298821900 -0400
@@ -477,26 +477,52 @@
         checkpoint_path=None,
         tokenizer_path=None,
         shard_fn=None,
+        low_mem=False,
+        compute_device=None,
     ):
+        """
+        low_mem (realtime-lucy): the umt5-xxl encoder is 11.4 GB in bf16,
+        which is more than a 6-8 GB consumer GPU holds and more than a 12-16
+        GB laptop can spare in RAM next to the DiT. In low_mem mode the
+        checkpoint is memory-mapped instead of read into RAM, the module is
+        built on the meta device and bound to the mapped tensors, and
+        __call__ streams the 24 encoder blocks through `compute_device` one
+        at a time (each ~390 MB), so a prompt is encoded with < 1 GB of GPU
+        memory and no resident copy of the weights at all.
+        """
         self.text_len = text_len
         self.dtype = dtype
         self.device = device
         self.checkpoint_path = checkpoint_path
         self.tokenizer_path = tokenizer_path
+        self.low_mem = low_mem
+        self.compute_device = compute_device
 
         # init model
-        model = umt5_xxl(
-            encoder_only=True,
-            return_tokenizer=False,
-            dtype=dtype,
-            device=device).eval().requires_grad_(False)
-        logging.info(f'loading {checkpoint_path}')
-        model.load_state_dict(torch.load(checkpoint_path, map_location='cpu'))
-        self.model = model
-        if shard_fn is not None:
-            self.model = shard_fn(self.model, sync_module_states=False)
+        if low_mem:
+            assert shard_fn is None, "low_mem T5 cannot be FSDP-sharded"
+            model = umt5_xxl(
+                encoder_only=True,
+                return_tokenizer=False,
+                dtype=dtype,
+                device='meta').eval().requires_grad_(False)
+            logging.info(f'memory-mapping {checkpoint_path}')
+            state = torch.load(checkpoint_path, map_location='cpu', mmap=True)
+            model.load_state_dict(state, assign=True)
+            self.model = model
         else:
-            self.model.to(self.device)
+            model = umt5_xxl(
+                encoder_only=True,
+                return_tokenizer=False,
+                dtype=dtype,
+                device=device).eval().requires_grad_(False)
+            logging.info(f'loading {checkpoint_path}')
+            model.load_state_dict(torch.load(checkpoint_path, map_location='cpu'))
+            self.model = model
+            if shard_fn is not None:
+                self.model = shard_fn(self.model, sync_module_states=False)
+            else:
+                self.model.to(self.device)
         # init tokenizer
         self.tokenizer = HuggingfaceTokenizer(
             name=tokenizer_path, seq_len=text_len, clean='whitespace')
@@ -504,8 +530,40 @@
     def __call__(self, texts, device):
         ids, mask = self.tokenizer(
             texts, return_mask=True, add_special_tokens=True)
+        if self.low_mem:
+            seq_lens = mask.gt(0).sum(dim=1).long()
+            context = self._encode_blockwise(ids, mask).to(device)
+            return [u[:v] for u, v in zip(context, seq_lens)]
         ids = ids.to(device)
         mask = mask.to(device)
         seq_lens = mask.gt(0).sum(dim=1).long()
         context = self.model(ids, mask)
         return [u[:v] for u, v in zip(context, seq_lens)]
+
+    @torch.no_grad()
+    def _encode_blockwise(self, ids, mask):
+        """Run T5Encoder.forward with each block's weights copied to the
+        compute device just for its own forward pass. Mirrors T5Encoder.forward
+        exactly (embedding → blocks with shared position bias → final norm);
+        dropout is identity in eval mode."""
+        from torch.func import functional_call
+
+        dev = self.compute_device or torch.device('cuda')
+        m = self.model
+
+        def gpu_params(module):
+            return {n: p.to(dev, non_blocking=False)
+                    for n, p in module.named_parameters()}
+
+        # Row-gather from the memory-mapped embedding table: only the pages
+        # holding the prompt's tokens are touched.
+        x = torch.nn.functional.embedding(ids.cpu(), m.token_embedding.weight).to(dev)
+        mask = mask.to(dev)
+        e = functional_call(m.pos_embedding, gpu_params(m.pos_embedding),
+                            (x.size(1), x.size(1)))
+        for block in m.blocks:
+            params = gpu_params(block)
+            x = functional_call(block, params, (x, mask), {'pos_bias': e})
+            del params
+        x = functional_call(m.norm, gpu_params(m.norm), (x,))
+        return x
diff -ru '--exclude=__pycache__' '--exclude=streaming.py' a/wan/modules/vae2_1.py b/wan/modules/vae2_1.py
--- a/wan/modules/vae2_1.py	2026-09-14 22:11:17.638355900 -0400
+++ b/wan/modules/vae2_1.py	2026-09-14 22:24:02.287637200 -0400
@@ -585,6 +585,88 @@
         self._enc_conv_num = count_conv3d(self.encoder)
         self._enc_conv_idx = [0]
         self._enc_feat_map = [None] * self._enc_conv_num
+        self._enc_stream_started = False
+        self._dec_stream_started = False
+
+    # ------------------------------------------------------------------
+    # Streaming API (realtime-lucy).
+    #
+    # encode()/decode() above already run the causal 3D convolutions frame
+    # group by frame group with a feature cache, but they clear that cache at
+    # the start and end of every call, so each call is an independent clip.
+    # The stream variants keep the cache alive between calls: a live video
+    # can be encoded 4 pixel frames (1 latent frame) at a time and the
+    # generated latents decoded 1 latent frame at a time, with the temporal
+    # receptive field carried over from the previous chunk exactly as it
+    # would be inside one long encode()/decode() call.
+    # ------------------------------------------------------------------
+
+    def stream_reset(self):
+        """Forget the running encoder and decoder state (new anchor frame)."""
+        self.clear_cache()
+
+    def encode_stream(self, x, scale):
+        """Encode the next pixel frames of a running stream.
+
+        x: [1, 3, T, H, W]. The very first call of a stream must start with
+        the anchor frame: T = 1 + 4k. Every later call must pass T = 4k.
+        Returns the latents for the new frames only: [1, 16, k(+1), h/8, w/8].
+        """
+        t = x.shape[2]
+        outs = []
+        i = 0
+        if not self._enc_stream_started:
+            self._enc_conv_idx = [0]
+            outs.append(
+                self.encoder(
+                    x[:, :, :1, :, :],
+                    feat_cache=self._enc_feat_map,
+                    feat_idx=self._enc_conv_idx))
+            self._enc_stream_started = True
+            i = 1
+        assert (t - i) % 4 == 0, (
+            f"encode_stream expects 1+4k frames on the first call and 4k "
+            f"afterwards, got T={t} (first={i == 1})")
+        while i < t:
+            self._enc_conv_idx = [0]
+            outs.append(
+                self.encoder(
+                    x[:, :, i:i + 4, :, :],
+                    feat_cache=self._enc_feat_map,
+                    feat_idx=self._enc_conv_idx))
+            i += 4
+        out = torch.cat(outs, 2) if len(outs) > 1 else outs[0]
+        mu, log_var = self.conv1(out).chunk(2, dim=1)
+        if isinstance(scale[0], torch.Tensor):
+            mu = (mu - scale[0].view(1, self.z_dim, 1, 1, 1)) * scale[1].view(
+                1, self.z_dim, 1, 1, 1)
+        else:
+            mu = (mu - scale[0]) * scale[1]
+        return mu
+
+    def decode_stream(self, z, scale):
+        """Decode the next latent frames of a running stream.
+
+        z: [1, 16, k, h/8, w/8]. Returns [1, 3, T, H, W] with T = 1 + 4(k-1)
+        on the first call of a stream (the anchor latent decodes to one
+        frame) and T = 4k afterwards.
+        """
+        if isinstance(scale[0], torch.Tensor):
+            z = z / scale[1].view(1, self.z_dim, 1, 1, 1) + scale[0].view(
+                1, self.z_dim, 1, 1, 1)
+        else:
+            z = z / scale[1] + scale[0]
+        x = self.conv2(z)
+        outs = []
+        for i in range(z.shape[2]):
+            self._conv_idx = [0]
+            outs.append(
+                self.decoder(
+                    x[:, :, i:i + 1, :, :],
+                    feat_cache=self._feat_map,
+                    feat_idx=self._conv_idx))
+        self._dec_stream_started = True
+        return torch.cat(outs, 2) if len(outs) > 1 else outs[0]
 
 
 def _video_vae(pretrained_path=None, z_dim=None, device='cpu', **kwargs):
@@ -659,3 +741,19 @@
                                   self.scale).float().clamp_(-1, 1).squeeze(0)
                 for u in zs
             ]
+
+    # Streaming wrappers (realtime-lucy): see WanVAE_.encode_stream/decode_stream.
+    def stream_reset(self):
+        self.model.stream_reset()
+
+    def encode_stream(self, video):
+        """video: [3, T, H, W] in [-1, 1] -> latents [16, k, h/8, w/8]."""
+        with amp.autocast(dtype=self.dtype):
+            return self.model.encode_stream(video.unsqueeze(0),
+                                            self.scale).float().squeeze(0)
+
+    def decode_stream(self, z):
+        """z: [16, k, h/8, w/8] -> frames [3, T, H, W] in [-1, 1]."""
+        with amp.autocast(dtype=self.dtype):
+            return self.model.decode_stream(z.unsqueeze(0),
+                                            self.scale).float().clamp_(-1, 1).squeeze(0)
```
