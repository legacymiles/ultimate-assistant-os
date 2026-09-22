# muapi.ai model catalogue

Extracted from Open-Generative-AI packages/studio/src/models.js (2026-09-19). POST https://api.muapi.ai/api/v1/<endpoint>. Inputs = accepted payload fields.

## audioModels (18)

| Name | Endpoint | Inputs |
|---|---|---|
| Suno Create Music | `suno-create-music` | prompt,style,model,custom_mode,title,persona_id,persona_model,instrumental,negative_tags,vocal_gender,style_weight,weirdness_constraint,audio_weight |
| Suno Remix Music | `suno-remix-music` | prompt,audio_url,style,model,custom_mode,title,persona_id,persona_model,instrumental,negative_tags,vocal_gender,style_weight,weirdness_constraint,audio_weight |
| Suno Extend Music | `suno-extend-music` | prompt,audio_url,style,model,custom_mode,title,persona_id,persona_model,continue_at,instrumental,negative_tags,vocal_gender,style_weight,weirdness_constraint,audio_weight |
| Suno Generate Sounds | `suno-generate-sounds` | prompt,model,sound_loop,sound_tempo,sound_key,grab_lyrics |
| Suno Add Vocals | `suno-add-vocals` | prompt,audio_url,style,negative_tags,model,vocal_gender,style_weight,weirdness_constraint,audio_weight,title |
| Suno Geneate Mashup | `suno-generate-mashup` | audios_list,prompt,style,instrumental,model,vocal_gender,style_weight,weirdness_constraint,audio_weight,title |
| Suno Add Instrumental | `suno-add-instrumental` | audio_url,tags,negative_tags,model,vocal_gender,style_weight,weirdness_constraint,audio_weight,title |
| Suno Voice Cloning | `suno-voice-clone` | audio_url,voice_name,description,style,language,vocal_start_s,vocal_end_s |
| Minimax Voice Clone | `minimax-voice-clone` | audio_url,custom_voice_id,model,need_noise_reduction,need_volume_normalization,accuracy,prompt |
| Minimax Speech HD | `minimax-speech-2.6-hd` | prompt,voice_id,speed,volume,pitch,emotion,english_normalization,sample_rate,bitrate,channel,format,language_boost |
| Minimax Speech Turbo | `minimax-speech-2.6-turbo` | prompt,voice_id,speed,volume,pitch,emotion,english_normalization,sample_rate,bitrate,channel,format,language_boost |
| MM Audio V2 | `mmaudio-v2/text-to-audio` | prompt,duration |
| ElevenLabs Text to Dialogue V3 | `elevenlabs-text-to-dialogue-v3` | dialogue,stability,language_code |
| Suno Convert to WAV | `suno-convert-to-wav` | task_id,audio_id |
| Gemini 3.1 Flash TTS | `gemini-3-1-flash-tts` | speakers,dialogue_turns,scene,sample_context,temperature |
| Gemini 2.5 Pro TTS | `gemini-2-5-pro-tts` | speakers,dialogue_turns,scene,sample_context,temperature |
| ElevenLabs TTS Turbo 2.5 | `elevenlabs-tts-turbo-2-5` | prompt,voice_id,stability,similarity_boost,speed,language_code |
| MiniMax Music 3.0 | `minimax-music-3.0` | prompt,lyrics,bitrate,sample_rate,is_instrumental |

## i2iModels (76)

| Name | Endpoint | Inputs |
|---|---|---|
| AI Image Upscaler | `ai-image-upscale` |  |
| AI Image Face Swap | `ai-image-face-swap` | target_index |
| AI Dress Change | `ai-dress-change` |  |
| AI Background Remover | `ai-background-remover` |  |
| AI Image Extension | `ai-image-extension` |  |
| AI Product Shot | `ai-product-shot` | scene_description |
| AI Skin Enhancer | `ai-skin-enhancer` |  |
| AI Color Photo | `ai-color-photo` |  |
| Flux Kontext Dev I2I | `flux-kontext-dev-i2i` | prompt,aspect_ratio,num_images |
| AI Product Photography | `ai-product-photography` | prompt |
| AI Ghibli Style | `ai-ghibli-style` |  |
| AI Object Eraser | `ai-object-eraser` |  |
| Flux Kontext Pro I2I | `flux-kontext-pro-i2i` | prompt,aspect_ratio |
| Flux Kontext Max I2I | `flux-kontext-max-i2i` | prompt,aspect_ratio |
| GPT-4o Image To Image | `gpt4o-image-to-image` | prompt,aspect_ratio,num_images |
| GPT-4o Mask Edit | `gpt4o-edit` | prompt,aspect_ratio,num_images |
| SeedEdit 3.0 | `bytedance-seededit-image` | prompt |
| MiniMax Image 01 Subject Reference | `minimax-01-subject-reference` | prompt,aspect_ratio,num_images |
| Ideogram 3.0 Character Reference | `ideogram-character` | prompt,render_speed,style,aspect_ratio,num_images |
| Flux Pulid | `flux-pulid` | prompt,aspect_ratio |
| Qwen Image Edit | `qwen-image-edit` | prompt,aspect_ratio |
| Image Effects | `image-effects` | name |
| Nano Banana | `nano-banana-edit` | prompt,aspect_ratio |
| Ideogram 3.0 Reframe | `ideogram-v3-reframe` | aspect_ratio,render_speed,style,num_images |
| Bytedance Seedream Edit v4 | `bytedance-seedream-edit-v4` | prompt,aspect_ratio,resolution,num_images |
| Nano Banana Effects | `nano-banana-effects` | name,aspect_ratio |
| Flux Kontext Effects | `flux-kontext-effects` | prompt,name |
| Flux Redux | `flux-redux` | prompt,aspect_ratio,num_images |
| Qwen Image Edit Plus | `qwen-image-edit-plus` | prompt,width,height |
| Wan2.5 Image Edit | `wan2.5-image-edit` | prompt,width,height |
| Reve Image Edit | `reve-image-edit` | prompt |
| Topaz Image Upscale | `topaz-image-upscale` | upscale_factor |
| Seedvr2 Image Upscale | `seedvr2-image-upscale` | resolution |
| Qwen Image Edit Plus Lora | `qwen-image-edit-plus-lora` | rotate_right_left,move_forward,vertical_angle,wide_angle_lens,width,height |
| Nano Banana Pro | `nano-banana-pro-edit` | prompt,aspect_ratio,resolution |
| Image Passthrough | `image-passthrough` | make_input |
| Kling O1 Edit Image | `kling-o1-edit-image` | prompt,aspect_ratio,resolution |
| Flux 2 Dev Edit | `flux-2-dev-edit` | prompt,width,height |
| Flux 2 Flex Edit | `flux-2-flex-edit` | prompt,aspect_ratio,resolution |
| Flux 2 Pro Edit | `flux-2-pro-edit` | prompt,aspect_ratio,resolution |
| Vidu Q2 Reference | `vidu-q2-reference-to-image` | prompt,aspect_ratio,resolution |
| Bytedance Seedream v4.5 Edit | `bytedance-seedream-v4.5-edit` | prompt,aspect_ratio,quality |
| Qwen Image Edit 2511 | `qwen-image-edit-2511` | prompt,width,height |
| Wan2.6 Image Edit | `wan2.6-image-edit` | prompt |
| Qwen Text To Image 2512 | `qwen-text-to-image-2512` | prompt,width,height |
| GPT Image 2 Edit | `gpt-image-2-image-to-image` | prompt,aspect_ratio,resolution |
| GPT Image 1.5 Edit | `gpt-image-1.5-edit` | prompt,aspect_ratio,quality |
| Grok Imagine Image To Image | `grok-imagine-image-to-image` | prompt |
| Api Node | `Api Node` | model_url,api_key |
| Flux 2 Klein 4b Edit | `flux-2-klein-4b-edit` | prompt,aspect_ratio |
| Flux 2 Klein 9b Edit | `flux-2-klein-9b-edit` | prompt,aspect_ratio |
| Add Image Watermark | `add-image-watermark` | position,opacity,scale |
| Nano Banana 2 | `nano-banana-2-edit` | prompt,aspect_ratio,resolution,google_search,output_format |
| Seedream 5.0 Edit | `seedream-5.0-edit` | prompt,aspect_ratio,quality |
| Seedream 4 Edit | `bytedance-seedream-edit-v4` | prompt,images_list,aspect_ratio,resolution,num_images |
| Seedream 5.0 Edit | `seedream-5.0-edit` | prompt,images_list,aspect_ratio,quality |
| Qwen Image 2.0 | `qwen-image-2.0-edit` | prompt,images_list,aspect_ratio |
| Qwen Image 2.0 Pro | `qwen-image-2.0-pro-edit` | prompt,images_list,aspect_ratio |
| Flux 2 Klein 4B Turbo Edit | `flux-2-klein-4b-turbo-edit` | prompt,images_list,aspect_ratio |
| Flux 2 Klein 9B Turbo Edit | `flux-2-klein-9b-turbo-edit` | prompt,images_list,aspect_ratio |
| AI Portrait Stylist | `portrait-stylist` | image_url,name,aspect_ratio |
| Seedance 2 Character | `seedance-2-character` | prompt,images_list,character_name |
| Wan 2.7 Image Edit | `wan2.7-image-edit` | prompt,images_list,aspect_ratio |
| Wan 2.7 Image Edit Pro | `wan2.7-image-edit-pro` | prompt,images_list,aspect_ratio |
| Flux 2 Klein 4B Edit LoRA | `flux-2-klein-4b-edit-lora` | prompt,images_list,lora_list,aspect_ratio |
| Flux 2 Klein 9B Edit LoRA | `flux-2-klein-9b-edit-lora` | prompt,images_list,lora_list,aspect_ratio |
| Kling O3 Image Edit | `kling-o3-image-edit` | prompt,images_list,aspect_ratio,resolution,num_images |
| Nano Banana 2 Lite | `nano-banana-2-lite-edit` | prompt,images_list,aspect_ratio |
| Seedream 5.0 Pro | `seedream-5.0-pro-edit` | prompt,images_list,aspect_ratio,resolution |
| Qwen 3 Image to Image | `qwen3-image-to-image` | prompt,images_list,resolution,aspect_ratio,output_format,prompt_extend,negative_prompt |
| Qwen 3 Pro Image to Image | `qwen3-pro-image-to-image` | prompt,images_list,resolution,aspect_ratio,output_format,prompt_extend,negative_prompt |
| Z-Image Turbo Image to Image LoRA | `z-image-turbo-image-to-image-lora` | prompt,image_url,loras,aspect_ratio,strength,output_format |
| Qwen Image Edit 2511 LoRA | `qwen-image-edit-2511-lora` | prompt,images_list,aspect_ratio,loras,output_format |
| Qwen Image Edit LoRA | `qwen-image-edit-lora` | prompt,image_url,aspect_ratio,loras,output_format |
| Face Expression Change | `face-expression-change` | images_list,aspect_ratio,rotate_right_left,move_forward,vertical_angle,wide_angle_lens,output_format |
| Muse Image Edit | `muse-image-edit` | prompt,images_list,aspect_ratio,output_format |

## i2vModels (173)

| Name | Endpoint | Inputs |
|---|---|---|
| AI Video Effects | `generate_wan_ai_effects` | prompt,name,aspect_ratio,resolution,quality,duration |
| Motion Controls | `generate_wan_ai_effects` | prompt,name,aspect_ratio,resolution,quality,duration |
| VFX | `generate_wan_ai_effects` | prompt,name,aspect_ratio,resolution,quality,duration |
| Veo 3 | `veo3-image-to-video` | prompt,aspect_ratio |
| Veo 3 Fast | `veo3-fast-image-to-video` | prompt,aspect_ratio |
| Runway Image To Video | `runway-image-to-video` | prompt,aspect_ratio,resolution,duration |
| Wan2.1 Image To Video | `wan2.1-image-to-video` | prompt,aspect_ratio,resolution,quality,duration |
| Hunyuan Image To Video | `hunyuan-image-to-video` | prompt,aspect_ratio |
| Kling v2.1 Master I2V | `kling-v2.1-master-i2v` | prompt,aspect_ratio,duration |
| Kling 2.1 Standard | `kling-v2.1-standard-i2v` | prompt,aspect_ratio,duration |
| Kling 2.1 Pro | `kling-v2.1-pro-i2v` | prompt,aspect_ratio,duration |
| Wan2.2 Image To Video | `wan2.2-image-to-video` | prompt,aspect_ratio,resolution,quality,duration |
| Runway Act-Two | `runway-act-two-i2v` | aspect_ratio |
| Pixverse v4.5 I2V | `pixverse-v4.5-i2v` | prompt,aspect_ratio,resolution,duration |
| Vidu v2.0 I2V | `vidu-v2.0-i2v` | prompt,aspect_ratio,resolution,duration |
| Vidu Q1 Reference | `vidu-q1-reference` | images_list,prompt,aspect_ratio |
| Minimax Hailuo 02 Standard I2V | `minimax-hailuo-02-standard-i2v` | prompt,duration,resolution |
| Minimax Hailuo 02 Pro I2V | `minimax-hailuo-02-pro-i2v` | prompt,duration,resolution |
| Video Effects | `video-effects` | name |
| Seedance Lite I2V | `seedance-lite-i2v` | prompt,resolution,duration,camera_fixed |
| Seedance Pro I2V | `seedance-pro-i2v` | prompt,resolution,duration,camera_fixed |
| Pixverse v5 I2V | `pixverse-v5-i2v` | prompt,aspect_ratio,resolution,duration |
| Seedance 1.0 Lite Reference | `seedance-lite-reference-to-video` | prompt,resolution,duration |
| Wan2.1 Reference Video | `wan2.1-reference-video` | prompt,resolution,aspect_ratio,duration |
| Kling v2.5 Turbo Pro I2V | `kling-v2.5-turbo-pro-i2v` | prompt,duration |
| Wan2.5 Image To Video | `wan2.5-image-to-video` | audio_url,prompt,resolution,duration |
| Wan2.5 Image To Video Fast | `wan2.5-image-to-video-fast` | audio_url,prompt,resolution,duration |
| Sora 2 | `openai-sora-2-image-to-video` | prompt,aspect_ratio,duration |
| Ovi Image To Video | `ovi-image-to-video` | prompt |
| Sora 2 Pro | `openai-sora-2-pro-image-to-video` | prompt,aspect_ratio,duration,resolution |
| Motion 2.0 | `leonardoai-motion-2.0` | prompt,aspect_ratio |
| Veo 3.1 | `veo3.1-image-to-video` | prompt,aspect_ratio,duration,resolution |
| Veo 3.1 Fast | `veo3.1-fast-image-to-video` | prompt,aspect_ratio,duration,resolution |
| Veo 3.1 Lite | `veo3.1-lite-image-to-video` | prompt,aspect_ratio,duration,resolution |
| Veo 3.1 Reference | `veo3.1-reference-to-video` | prompt,resolution,duration,generate_audio |
| Seedance Pro I2V Fast | `seedance-pro-i2v-fast` | prompt,resolution,duration,camera_fixed |
| LTX 2 Pro | `ltx-2-pro-image-to-video` | prompt,duration,generate_audio |
| LTX 2 Fast | `ltx-2-fast-image-to-video` | prompt,duration,generate_audio |
| Vidu Q2 Reference | `vidu-q2-reference` | images_list,prompt,resolution,aspect_ratio,duration,movement_amplitude |
| Vidu Q2 Turbo Start End | `vidu-q2-turbo-start-end-video` | prompt,resolution,duration,bgm,movement_amplitude |
| Vidu Q2 Pro Start End | `vidu-q2-pro-start-end-video` | prompt,resolution,duration,bgm,movement_amplitude |
| Minimax Hailuo 2.3 Pro I2V | `minimax-hailuo-2.3-pro-i2v` | prompt,resolution |
| Minimax Hailuo 2.3 Standard I2V | `minimax-hailuo-2.3-standard-i2v` | prompt,duration |
| MiniMax Hailuo 2.3 Fast | `minimax-hailuo-2.3-fast` | prompt,duration,go_fast |
| Kling 2.5 Turbo Standard | `kling-v2.5-turbo-std-i2v` | prompt,duration |
| Grok Imagine Image To Video | `grok-imagine-image-to-video` | images_list,prompt,aspect_ratio,mode,resolution,duration |
| Kling O1 Pro | `kling-o1-image-to-video` | prompt,aspect_ratio,duration |
| Kling O1 Pro Reference | `kling-o1-reference-to-video` | images_list,prompt,aspect_ratio,duration,keep_original_sound |
| Kling v2.6 Pro I2V | `kling-v2.6-pro-i2v` | prompt,duration,sound |
| Pixverse v5.5 I2V | `pixverse-v5.5-i2v` | style,thinking,audio,multi_clip,prompt,aspect_ratio,resolution,duration |
| Wan2.2 Spicy Image To Video | `wan2.2-spicy-image-to-video` | prompt,resolution,duration |
| Wan2.6 Image To Video | `wan2.6-image-to-video` | audio_url,prompt,resolution,duration,shot_type |
| Kling O1 Standard | `kling-o1-standard-image-to-video` | prompt,duration |
| Kling O1 Standard Reference | `kling-o1-standard-reference-to-video` | images_list,prompt,aspect_ratio,duration |
| Seedance v1.5 Pro I2V | `seedance-v1.5-pro-i2v` | prompt,aspect_ratio,resolution,duration,generate_audio,camera_fixed |
| Seedance v1.5 Pro I2V Fast | `seedance-v1.5-pro-i2v-fast` | prompt,aspect_ratio,resolution,duration,generate_audio,camera_fixed |
| LTX 2 19B | `ltx-2-19b-image-to-video` | prompt,resolution,duration |
| Kling v3.0 Omni Standard Image To Video | `kling-v3.0-omni-standard-image-to-video` | images_list,prompt,aspect_ratio,duration,generate_audio |
| Kling v3.0 Omni Pro Image To Video | `kling-v3.0-omni-pro-image-to-video` | images_list,prompt,aspect_ratio,duration,generate_audio |
| Kling v3.0 Omni 4K Image To Video | `kling-v3.0-omni-4k-image-to-video` | images_list,prompt,aspect_ratio,duration |
| Kling v3.0 Pro Image To Video | `kling-v3.0-pro-image-to-video` | prompt,duration,generate_audio |
| Kling v3.0 Standard Image To Video | `kling-v3.0-standard-image-to-video` | prompt,duration,generate_audio |
| Seedance 2.0 I2V | `seedance-v2.0-i2v` | prompt,aspect_ratio,duration,quality |
| Seedance 2 I2V | `seedance-v2.0-i2v` | prompt,images_list,aspect_ratio,duration,quality |
| LTX 2.3 | `ltx-2.3-image-to-video` | prompt,image_url,duration,resolution,seed |
| Seedance 2 New First Last | `seedance-2.0-new-first-last` | prompt,images_list,aspect_ratio,quality,duration |
| Seedance 2 Omni Reference | `seedance-2.0-omni-reference` | prompt,images_list,video_files,audio_files,aspect_ratio,quality,duration |
| Pixverse v6 I2V | `pixverse-v6-i2v` | prompt,images_list,resolution,duration,thinking_type,generate_audio_switch |
| PixVerse V6 Transition | `pixverse-v6-transition` | prompt,image_url,last_image,aspect_ratio,resolution,duration,thinking_type,style,negative_prompt,generate_audio_switch |
| Wan2.7 | `wan2.7-image-to-video` | prompt,image_url,last_image,audio_url,resolution,duration,negative_prompt |
| Wan 2.7 Reference | `wan2.7-reference-to-video` | prompt,images_list,videos_list,image_url,aspect_ratio,resolution,duration,negative_prompt |
| Seedance 2 I2V 480P | `seedance-2.0-i2v-480p` | prompt,images_list,aspect_ratio,duration,quality |
| Seedance 2 Omni Reference 480P | `seedance-2.0-omni-reference-480p` | prompt,images_list,video_files,audio_files,aspect_ratio,quality,duration |
| Seedance 2 | `seedance-2-image-to-video` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 Image to Video Fast | `seedance-2-image-to-video-fast` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 First Last Frame | `seedance-2-first-last-frame` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 First Last Frame Fast | `seedance-2-first-last-frame-fast` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 Omni Reference No Video | `seedance-2-omni-reference-no-video` | prompt,images_list,audio_files,aspect_ratio,duration |
| Seedance 2 Omni Reference No Video Fast | `seedance-2-omni-reference-no-video-fast` | prompt,images_list,audio_files,aspect_ratio,duration |
| Seedance 2 VIP | `seedance-2-vip-image-to-video` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Image to Video Fast | `seedance-2-vip-image-to-video-fast` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP First Last Frame | `seedance-2-vip-first-last-frame` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP First Last Frame Fast | `seedance-2-vip-first-last-frame-fast` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Omni Reference | `seedance-2-vip-omni-reference` | prompt,images_list,video_files,audio_files,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Omni Reference Fast | `seedance-2-vip-omni-reference-fast` | prompt,images_list,video_files,audio_files,aspect_ratio,duration,high_bitrate |
| Happy Horse 1 Image to Video 1080P | `happy-horse-1-image-to-video-1080p` | prompt,images_list,aspect_ratio,duration |
| Happy Horse 1 Image to Video 720P | `happy-horse-1-image-to-video-720p` | prompt,images_list,aspect_ratio,duration |
| Veo 4 | `veo-4-image-to-video` | images_list,prompt,aspect_ratio,duration |
| Seedance 2 VIP Image to Video 1080P | `sd-2-vip-image-to-video-1080p` | images_list,prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Image to Video Fast 1080P | `sd-2-vip-image-to-video-fast-1080p` | images_list,prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Omni Reference 1080P | `sd-2-vip-omni-reference-1080p` | prompt,images_list,video_files,audio_files,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Omni Reference Fast 1080P | `sd-2-vip-omni-reference-fast-1080p` | prompt,images_list,video_files,audio_files,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP First Last Frame 1080P | `sd-2-vip-first-last-frame-1080p` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Kling v3.0 4K | `kling-v3.0-4k-image-to-video` | prompt,image_url,last_image,duration,generate_audio |
| Vidu Q3 Pro | `vidu-q3-pro-image-to-video` | prompt,image_url,resolution,aspect_ratio,duration,audio |
| Vidu Q3 Pro First Last Frames | `vidu-q3-pro-first-last-frames` | prompt,image_url,last_image,resolution,aspect_ratio,duration,audio |
| Vidu Q3 Turbo | `vidu-q3-turbo-image-to-video` | prompt,image_url,resolution,aspect_ratio,duration,audio |
| Vidu Q3 Turbo First Last Frames | `vidu-q3-turbo-first-last-frames` | prompt,image_url,last_image,resolution,aspect_ratio,duration,audio |
| Vidu Q2 Pro | `vidu-q2-pro-image-to-video` | prompt,image_url,resolution,aspect_ratio,duration,bgm,movement_amplitude |
| Vidu Q2 Turbo | `vidu-q2-turbo-image-to-video` | prompt,image_url,resolution,aspect_ratio,duration,bgm,movement_amplitude |
| HappyHorse 1.0 Reference 1080P | `happy-horse-1-reference-to-video-1080p` | prompt,images_list,aspect_ratio,duration,seed |
| HappyHorse 1.0 Reference 720P | `happy-horse-1-reference-to-video-720p` | prompt,images_list,aspect_ratio,duration,seed |
| Gemini Omni | `gemini-omni-image-to-video` | prompt,image_urls,duration,resolution,aspect_ratio,audio_ids,seed,character_ids |
| Grok Imagine Video 1.5 Preview | `grok-imagine-video-1-5-preview` | prompt,images_list,aspect_ratio,resolution,duration |
| Kling v3 Turbo Standard | `kling-v3-turbo-standard-image-to-video` | prompt,image_url,duration |
| Kling v3 Turbo Pro | `kling-v3-turbo-pro-image-to-video` | prompt,image_url,duration |
| Seedance 2.5 | `seedance-2.5-image-to-video` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2 Mini | `seedance-2-mini-image-to-video` | prompt,images_list,aspect_ratio,resolution,duration,generate_audio,high_bitrate |
| Happy Horse 1.1 Image to Video 1080P | `happy-horse-1.1-image-to-video-1080p` | prompt,images_list,aspect_ratio,duration |
| Happy Horse 1.1 Image to Video 720P | `happy-horse-1.1-image-to-video-720p` | prompt,images_list,aspect_ratio,duration |
| HappyHorse 1.1 Reference 1080P | `happy-horse-1.1-reference-to-video-1080p` | prompt,images_list,aspect_ratio,duration,seed |
| HappyHorse 1.1 Reference 720P | `happy-horse-1.1-reference-to-video-720p` | prompt,images_list,aspect_ratio,duration,seed |
| Seedance 2 VIP Image to Video 4K | `sd-2-vip-image-to-video-4k` | images_list,prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP First Last Frame 4K | `sd-2-vip-first-last-frame-4k` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Omni Reference 4K | `sd-2-vip-omni-reference-4k` | prompt,images_list,video_files,audio_files,aspect_ratio,duration,high_bitrate |
| Seedance 2.5 Spicy | `seedance-2.5-spicy-image-to-video` | resolution,generate_audio,prompt,image_url,duration,high_bitrate,aspect_ratio,seed |
| Seedance 2.5 Image to Video 480p | `seedance-2.5-image-to-video-480p` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 First & Last Frame | `seedance-2.5-first-last-frame` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 First Last Frame 480p | `seedance-2.5-first-last-frame-480p` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Omni Reference | `seedance-2.5-omni-reference` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Omni Reference 480p | `seedance-2.5-omni-reference-480p` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2 Spicy | `seedance-2-spicy-image-to-video` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 Spicy Image to Video Fast | `seedance-2-spicy-image-to-video-fast` | prompt,images_list,aspect_ratio,duration,high_bitrate |
| Seedance 2 Mini Spicy | `seedance-2-mini-spicy-image-to-video` | prompt,images_list,aspect_ratio,resolution,duration,generate_audio,high_bitrate |
| MiniMax H3 Image to Video | `minimax-h3-image-to-video` | prompt,image_url,last_image_url,resolution,duration |
| MiniMax H3 Reference | `minimax-h3-reference-to-video` | prompt,reference_images,reference_videos,reference_audios,aspect_ratio,resolution,duration |
| MiniMax H3 Open Image to Video | `minimax-h3-open-image-to-video` | prompt,image_url,last_image,resolution,duration,seed |
| MiniMax H3 Base Ref2VA | `minimax-h3-open-reference-to-video` | prompt,images_list,videos_list,audios_list,aspect_ratio,resolution,duration,seed |
| FLUX 3 | `flux-3-image-to-video` | prompt,image_url,aspect_ratio,resolution,duration,generate_audio |
| Wan 3.0 | `wan3.0-image-to-video` | prompt,image_url,last_image,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Wan 3.0 Spicy | `wan3.0-spicy-image-to-video` | prompt,image_url,last_image,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Seedance 2.5 Image to Video 1080p | `seedance-2.5-image-to-video-1080p` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Image to Video 4K | `seedance-2.5-image-to-video-4k` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 First Last Frame 1080p | `seedance-2.5-first-last-frame-1080p` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 First Last Frame 4K | `seedance-2.5-first-last-frame-4k` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Omni Reference 1080p | `seedance-2.5-omni-reference-1080p` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Omni Reference 4K | `seedance-2.5-omni-reference-4k` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Intl | `seedance-2.5-intl-image-to-video` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Image to Video 480p | `seedance-2.5-intl-image-to-video-480p` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Image to Video 480p | `seedance-2.5-spicy-image-to-video-480p` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Image to Video 1080p | `seedance-2.5-intl-image-to-video-1080p` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Image to Video 1080p | `seedance-2.5-spicy-image-to-video-1080p` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Image to Video 4K | `seedance-2.5-intl-image-to-video-4k` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Image to Video 4K | `seedance-2.5-spicy-image-to-video-4k` | prompt,image_url,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl First Last Frame | `seedance-2.5-intl-first-last-frame` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy First Last Frame | `seedance-2.5-spicy-first-last-frame` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl First Last Frame 480p | `seedance-2.5-intl-first-last-frame-480p` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy First Last Frame 480p | `seedance-2.5-spicy-first-last-frame-480p` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl First Last Frame 1080p | `seedance-2.5-intl-first-last-frame-1080p` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy First Last Frame 1080p | `seedance-2.5-spicy-first-last-frame-1080p` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl First Last Frame 4K | `seedance-2.5-intl-first-last-frame-4k` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy First Last Frame 4K | `seedance-2.5-spicy-first-last-frame-4k` | prompt,images_list,duration,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Omni Reference | `seedance-2.5-intl-omni-reference` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Spicy Omni Reference | `seedance-2.5-spicy-omni-reference` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Intl Omni Reference 480p | `seedance-2.5-intl-omni-reference-480p` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Spicy Omni Reference 480p | `seedance-2.5-spicy-omni-reference-480p` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Intl Omni Reference 1080p | `seedance-2.5-intl-omni-reference-1080p` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Spicy Omni Reference 1080p | `seedance-2.5-spicy-omni-reference-1080p` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Intl Omni Reference 4K | `seedance-2.5-intl-omni-reference-4k` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Seedance 2.5 Spicy Omni Reference 4K | `seedance-2.5-spicy-omni-reference-4k` | prompt,images_list,videos_list,audios_list,duration,aspect_ratio,seed,omni_reference_task_type,high_bitrate |
| Wan 2.7 Spicy | `wan2.7-image-to-video-spicy` | image_url,prompt,negative_prompt,audio_url,resolution,duration,shot_type,enable_prompt_expansion,seed |
| Wan 2.6 Spicy | `wan2.6-image-to-video-spicy` | image_url,prompt,negative_prompt,audio_url,resolution,duration,shot_type,enable_prompt_expansion,seed |
| MiniMax H3 Image to Video LoRA | `minimax-h3-image-to-video-lora` | prompt,image_url,last_image,resolution,duration,seed,loras |
| MiniMax H3 Reference to Video LoRA | `minimax-h3-reference-to-video-lora` | prompt,images_list,videos_list,audios_list,aspect_ratio,resolution,duration,seed,loras |
| LTX 2.5 | `ltx-2.5-image-to-video` | prompt,image_url,last_image,duration,resolution,seed |
| Wan 3.0 Reference to Video | `wan3.0-reference-to-video` | prompt,images_list,videos_list,audios_list,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Wan 3.0 Prime | `wan3.0-prime-image-to-video` | prompt,image_url,last_image,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Wan 3.0 Prime Reference to Video | `wan3.0-prime-reference-to-video` | prompt,images_list,videos_list,audios_list,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Wan 3.0 Spicy Reference to Video | `wan3.0-spicy-reference-to-video` | prompt,images_list,videos_list,audios_list,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| FLUX 3 Start End to Video | `flux-3-start-end-to-video` | prompt,image_url,end_image_url,aspect_ratio,resolution,duration,generate_audio |
| Gemini Omni Flash 1.1 | `gemini-omni-flash-1-1-image-to-video` | prompt,first_frame_url,last_frame_url,aspect_ratio,resolution,seed |
| Gemini Omni 1.1 Flash Reference | `gemini-omni-flash-1-1-reference-to-video` | prompt,image_urls,reference_video_urls,aspect_ratio,resolution,duration |
| MiniMax H3 Spicy | `minimax-h3-image-to-video-spicy` | image_url,prompt,last_image,resolution,duration,seed |

## imageLipSyncModels (9)

| Name | Endpoint | Inputs |
|---|---|---|
| Infinite Talk | `infinitetalk-image-to-video` | resolution |
| Wan 2.2 Speech to Video | `wan2.2-speech-to-video` | resolution |
| LTX 2.3 Lipsync | `ltx-2.3-lipsync` | resolution |
| LTX 2 19B Lipsync | `ltx-2-19b-lipsync` | resolution |
| Kling v1 Avatar Standard | `kling-v1-avatar-standard` |  |
| Kling v1 Avatar Pro | `kling-v1-avatar-pro` |  |
| Kling v2 Avatar Standard | `kling-v2-avatar-standard` |  |
| Kling v2 Avatar Pro | `kling-v2-avatar-pro` |  |
| Omnihuman 1 5 | `omnihuman-1-5` | output_resolution |

## lipsyncModels (15)

| Name | Endpoint | Inputs |
|---|---|---|
| Infinite Talk | `infinitetalk-image-to-video` | resolution |
| Wan 2.2 Speech to Video | `wan2.2-speech-to-video` | resolution |
| LTX 2.3 Lipsync | `ltx-2.3-lipsync` | resolution |
| LTX 2 19B Lipsync | `ltx-2-19b-lipsync` | resolution |
| Sync Lipsync | `sync-lipsync` |  |
| LatentSync | `latentsync-video` |  |
| Creatify Lipsync | `creatify-lipsync` |  |
| Veed Lipsync | `veed-lipsync` |  |
| Infinite Talk V2V | `infinitetalk-video-to-video` | resolution |
| Volcengine Video to Video Lip Sync | `volcengine-video-to-video-lip-sync` | mode |
| Kling v1 Avatar Standard | `kling-v1-avatar-standard` |  |
| Kling v1 Avatar Pro | `kling-v1-avatar-pro` |  |
| Kling v2 Avatar Standard | `kling-v2-avatar-standard` |  |
| Kling v2 Avatar Pro | `kling-v2-avatar-pro` |  |
| Omnihuman 1 5 | `omnihuman-1-5` | output_resolution |

## motionControlModels (2)

| Name | Endpoint | Inputs |
|---|---|---|
| Seedance 2.5 Motion Control | `seedance-2.5-motion-control` |  |
| Seedance 2.0 Motion Control | `seedance-2-motion-control` |  |

## recastModels (3)

| Name | Endpoint | Inputs |
|---|---|---|
| Kling 3.0 Pro Motion Control | `kling-v3.0-pro-motion-control` |  |
| Runway Act Two | `runway-act-two-i2v` | aspect_ratio |
| Wan2.2 Animate | `wan2.2-animate` |  |

## t2iModels (78)

| Name | Endpoint | Inputs |
|---|---|---|
| Nano Banana | `nano-banana` | prompt,aspect_ratio |
| FLUX.1 Dev | `flux-dev-image` | prompt,width,height,num_images |
| FLUX.1 Kontext Dev | `flux-kontext-dev-t2i` | prompt,aspect_ratio,num_images |
| HiDream I1 Fast | `hidream_i1_fast_image` | prompt,width,height,num_images |
| HiDream I1 Dev | `hidream_i1_dev_image` | prompt,width,height,num_images |
| HiDream I1 Full | `hidream_i1_full_image` | prompt,width,height,num_images |
| Ai Anime Generator | `ai-anime-generator` | prompt,width,height |
| Wan 2.1 | `wan2.1-text-to-image` | prompt,width,height |
| FLUX.1 Kontext Pro | `flux-kontext-pro-t2i` | prompt,aspect_ratio |
| FLUX.1 Kontext Max | `flux-kontext-max-t2i` | prompt,aspect_ratio |
| GPT-4o | `gpt4o-text-to-image` | prompt,aspect_ratio,num_images |
| FLUX.1 Schnell | `flux-schnell-image` | prompt,width,height,num_images |
| Seedream 3.0 | `bytedance-seedream-image` | prompt,aspect_ratio |
| Qwen Image | `qwen-image` | prompt,aspect_ratio,num_images |
| Flux Pulid | `flux-pulid` | prompt,image_url,aspect_ratio |
| Ideogram 3.0 | `ideogram-v3-t2i` | prompt,render_speed,style,aspect_ratio,num_images |
| Imagen 4 | `google-imagen4` | prompt,aspect_ratio,num_images |
| Imagen 4 Fast | `google-imagen4-fast` | prompt,aspect_ratio,num_images |
| Imagen 4 Ultra | `google-imagen4-ultra` | prompt,aspect_ratio |
| Stable Diffusion XL 1.0 | `sdxl-image` | prompt,width,height |
| Seedream 4.0 | `bytedance-seedream-v4` | prompt,aspect_ratio,resolution,num_images |
| Hunyuan Image 2.1 | `hunyuan-image-2.1` | prompt,width,height |
| Chroma Image | `chroma-image` | prompt,width,height |
| FLUX.1 Redux Dev | `flux-redux` | prompt,image_url,aspect_ratio,num_images |
| FLUX.1 Krea Dev | `flux-krea-dev` | prompt,aspect_ratio,num_images |
| Perfect Pony Xl | `perfect-pony-xl` | prompt,width,height |
| Neta Lumina | `neta-lumina` | prompt,width,height |
| Wan 2.5 | `wan2.5-text-to-image` | prompt,width,height |
| Hunyuan Image 3.0 | `hunyuan-image-3.0` | prompt,width,height |
| Leonardo Phoenix 1.0 | `leonardoai-phoenix-1.0` | prompt,aspect_ratio |
| Lucid Origin | `leonardoai-lucid-origin` | prompt,aspect_ratio |
| Reve Image | `reve-text-to-image` | prompt,aspect_ratio |
| Grok Imagine Image | `grok-imagine-text-to-image` | prompt,aspect_ratio |
| Nano Banana Pro | `nano-banana-pro` | prompt,aspect_ratio,resolution |
| Kling Image O1 | `kling-o1-text-to-image` | prompt,aspect_ratio,resolution,num_images |
| Z Image Turbo | `z-image-turbo` | prompt,width,height |
| FLUX.2 Dev | `flux-2-dev` | prompt,width,height |
| FLUX.2 Flex | `flux-2-flex` | prompt,aspect_ratio,resolution |
| FLUX.2 Pro | `flux-2-pro` | prompt,aspect_ratio,resolution |
| Vidu Q2 Image | `vidu-q2-text-to-image` | prompt,aspect_ratio,resolution |
| Seedream 4.5 | `bytedance-seedream-v4.5` | prompt,aspect_ratio,quality |
| GPT Image 1.5 | `gpt-image-1.5` | prompt,aspect_ratio,quality |
| GPT Image 2 | `gpt-image-2-text-to-image` | prompt,aspect_ratio,resolution |
| Wan 2.6 | `wan2.6-text-to-image` | prompt,width,height |
| Qwen Image 2512 | `qwen-text-to-image-2512` | prompt,width,height |
| FLUX.2 Klein 4B | `flux-2-klein-4b` | prompt,aspect_ratio |
| FLUX.2 Klein 9B | `flux-2-klein-9b` | prompt,aspect_ratio |
| Z Image Base | `z-image-base` | prompt,image_url,aspect_ratio,strength |
| Nano Banana 2 | `nano-banana-2` | prompt,aspect_ratio,resolution,google_search,output_format |
| Seedream 5.0 | `seedream-5.0` | prompt,aspect_ratio,quality |
| Seedream 5.0 | `seedream-5.0` | prompt,aspect_ratio,quality |
| Z-Image P | `z-image-p` | prompt,negative_prompt,width,height,seed,flow_shift,batch_size |
| Qwen Image 2.0 | `qwen-image-2.0` | prompt,aspect_ratio |
| Qwen Image 2.0 Pro | `qwen-image-2.0-pro` | prompt,aspect_ratio |
| Flux 2 Klein 4B Turbo | `flux-2-klein-4b-turbo` | prompt,aspect_ratio |
| Flux 2 Klein 9B Turbo | `flux-2-klein-9b-turbo` | prompt,aspect_ratio |
| Wan 2.7 Image | `wan2.7-text-to-image` | prompt,aspect_ratio,thinking_mode |
| Wan 2.7 Image Pro | `wan2.7-text-to-image-pro` | prompt,thinking_mode,aspect_ratio |
| Midjourney V7 | `midjourney-v7` | prompt,image_url,aspect_ratio,stylize,chaos,weird,negative_prompt,seed |
| Midjourney V8 | `midjourney-v8` | prompt,image_url,aspect_ratio,stylize,chaos,weird,negative_prompt,seed |
| Midjourney Niji | `midjourney-niji` | prompt,image_url,aspect_ratio,stylize,chaos,weird,negative_prompt,seed |
| Grok Imagine Image Quality | `grok-imagine-text-to-image-quality` | prompt,aspect_ratio |
| Flux 2 Klein 4B LoRA | `flux-2-klein-4b-text-to-image-lora` | prompt,lora_list,aspect_ratio |
| Flux 2 Klein 9B LoRA | `flux-2-klein-9b-text-to-image-lora` | prompt,lora_list,aspect_ratio |
| Kling O3 Image | `kling-o3-image` | prompt,aspect_ratio,resolution,num_images |
| Nano Banana 2 Lite | `nano-banana-2-lite` | prompt,aspect_ratio |
| Seedream 5.0 Pro | `seedream-5.0-pro` | prompt,aspect_ratio,resolution |
| Qwen Image 3.0 | `qwen3-text-to-image` | prompt,resolution,aspect_ratio,output_format,prompt_extend,negative_prompt |
| Qwen Image 3.0 Pro | `qwen3-pro-text-to-image` | prompt,resolution,aspect_ratio,output_format,prompt_extend,negative_prompt |
| Z-Image Base LoRA | `z-image-base-text-to-image-lora` | prompt,image_url,loras,aspect_ratio,strength,output_format |
| Z-Image Turbo LoRA | `z-image-turbo-text-to-image-lora` | prompt,loras,aspect_ratio,output_format |
| Grok Imagine Image 2.0 | `grok-imagine-image-2` | prompt,aspect_ratio |
| Flux Dev Style LoRA Inference | `flux-1-dev-style-lora-inference` | prompt,lora_url,lora_weight,aspect_ratio |
| Krea 2 Turbo | `krea-v2-turbo` | prompt,image_url,aspect_ratio,resolution,strength,seed |
| Krea 2 Turbo LoRA | `krea-v2-turbo-lora` | prompt,image_url,loras,aspect_ratio,resolution,strength,seed |
| Muse Image | `muse-image-text-to-image` | prompt,aspect_ratio,output_format |
| Qwen Image LoRA | `qwen-image-text-to-image-lora` | prompt,aspect_ratio,loras,output_format |
| Qwen Image 2512 LoRA | `qwen-image-text-to-image-2512-lora` | prompt,aspect_ratio,loras,output_format |

## t2vModels (105)

| Name | Endpoint | Inputs |
|---|---|---|
| Seedance 1.0 Lite | `seedance-lite-t2v` | prompt,aspect_ratio,duration,resolution |
| Seedance 1.0 Pro | `seedance-pro-t2v` | prompt,aspect_ratio,duration,resolution |
| Seedance 1.0 Pro Fast | `seedance-pro-t2v-fast` | prompt,aspect_ratio,duration,resolution |
| Seedance 1.5 Pro | `seedance-v1.5-pro-t2v` | prompt,aspect_ratio,duration,resolution |
| Seedance v1.5 Pro Fast | `seedance-v1.5-pro-t2v-fast` | prompt,aspect_ratio,duration,resolution |
| Seedance 2.0 | `seedance-v2.0-t2v` | prompt,aspect_ratio,duration,quality |
| Seedance 2.0 Extend | `seedance-v2.0-extend` | request_id,prompt,images_list,video_files,duration,quality |
| Kling 2.1 Master | `kling-v2.1-master-t2v` | prompt,aspect_ratio,duration |
| Kling 2.5 Turbo Pro | `kling-v2.5-turbo-pro-t2v` | prompt,aspect_ratio,duration |
| Kling 2.6 Pro | `kling-v2.6-pro-t2v` | sound,prompt,aspect_ratio,duration |
| Kling O1 Pro | `kling-o1-text-to-video` | prompt,aspect_ratio,duration |
| Kling 3.0 Pro | `kling-v3.0-pro-text-to-video` | generate_audio,prompt,aspect_ratio,duration |
| Kling 3.0 Standard | `kling-v3.0-standard-text-to-video` | generate_audio,prompt,aspect_ratio,duration |
| Veo 3 | `veo3-text-to-video` | prompt,aspect_ratio |
| Veo 3 Fast | `veo3-fast-text-to-video` | prompt,aspect_ratio |
| Veo 3.1 | `veo3.1-text-to-video` | prompt,aspect_ratio,duration,resolution |
| Veo 3.1 Fast | `veo3.1-fast-text-to-video` | prompt,aspect_ratio,duration,resolution |
| Veo 3.1 Lite | `veo3.1-lite-text-to-video` | prompt,aspect_ratio,duration,resolution |
| Runway Gen-3 | `runway-text-to-video` | prompt,aspect_ratio,duration,resolution |
| Wan 2.1 | `wan2.1-text-to-video` | prompt,aspect_ratio,duration,resolution,quality |
| Wan 2.2 | `wan2.2-text-to-video` | prompt,aspect_ratio,duration,resolution,quality |
| Wan 2.2 Fast | `wan2.2-5b-fast-t2v` | prompt,aspect_ratio,resolution |
| Wan 2.5 | `wan2.5-text-to-video` | audio_url,prompt,aspect_ratio,duration,resolution |
| Wan 2.5 Fast | `wan2.5-text-to-video-fast` | audio_url,prompt,aspect_ratio,duration,resolution |
| Wan 2.6 | `wan2.6-text-to-video` | shot_type,audio_url,prompt,aspect_ratio,duration,resolution |
| Hunyuan | `hunyuan-text-to-video` | prompt,aspect_ratio |
| Hunyuan Fast | `hunyuan-fast-text-to-video` | prompt,aspect_ratio |
| PixVerse V4.5 | `pixverse-v4.5-t2v` | prompt,aspect_ratio,duration,resolution |
| PixVerse V5 | `pixverse-v5-t2v` | prompt,aspect_ratio,duration,resolution |
| PixVerse V5.5 | `pixverse-v5.5-t2v` | style,thinking,audio,multi_clip,prompt,aspect_ratio,duration,resolution |
| MiniMax Hailuo 02 Standard | `minimax-hailuo-02-standard-t2v` | prompt,duration,resolution |
| MiniMax Hailuo 02 Pro | `minimax-hailuo-02-pro-t2v` | prompt,duration,resolution |
| MiniMax Hailuo 2.3 Pro | `minimax-hailuo-2.3-pro-t2v` | prompt,resolution |
| MiniMax Hailuo 2.3 Standard | `minimax-hailuo-2.3-standard-t2v` | prompt,duration |
| Sora | `openai-sora` | prompt,aspect_ratio,resolution |
| Sora 2 | `openai-sora-2-text-to-video` | prompt,aspect_ratio,duration |
| Sora 2 Pro | `openai-sora-2-pro-text-to-video` | prompt,aspect_ratio,duration,resolution |
| Vidu 2.0 | `vidu-v2.0-t2v` | prompt,aspect_ratio,duration,resolution |
| Ovi | `ovi-text-to-video` | prompt,aspect_ratio |
| Grok Imagine | `grok-imagine-text-to-video` | prompt,aspect_ratio,mode,resolution,duration |
| LTX 2 Pro | `ltx-2-pro-text-to-video` | generate_audio,prompt,duration |
| LTX 2 Fast | `ltx-2-fast-text-to-video` | generate_audio,prompt,duration |
| LTX 2 19B | `ltx-2-19b-text-to-video` | prompt,aspect_ratio,duration,resolution |
| Veo 3.1 Extend | `veo3.1-extend-video` | request_id,prompt |
| Veo 3.1 4K | `veo3.1-4k-video` | request_id |
| Seedance 2 T2V | `seedance-v2.0-t2v` | prompt,aspect_ratio,duration,quality |
| Seedance 2 Extend | `seedance-v2.0-extend` | request_id,prompt,images_list,video_files,audio_files,aspect_ratio,duration,quality |
| LTX 2.3 | `ltx-2.3-text-to-video` | prompt,duration,aspect_ratio,resolution,seed |
| Seedance 2 New T2V | `seedance-2.0-new-t2v` | prompt,aspect_ratio,quality,duration |
| Grok Imagine Extend | `grok-imagine-extend` | request_id,prompt,extend_times,resolution |
| PixVerse V6 | `pixverse-v6-t2v` | prompt,aspect_ratio,resolution,duration,generate_audio_switch |
| Wan2.7 | `wan2.7-text-to-video` | prompt,audio_url,aspect_ratio,resolution,duration,negative_prompt |
| Seedance 2 T2V 480P | `seedance-2.0-t2v-480p` | prompt,aspect_ratio,duration,quality |
| Seedance 2 | `seedance-2-text-to-video` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2.0 Fast | `seedance-2-text-to-video-fast` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP | `seedance-2-vip-text-to-video` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Text to Video Fast | `seedance-2-vip-text-to-video-fast` | prompt,aspect_ratio,duration,high_bitrate |
| HappyHorse 1.0 1080P | `happy-horse-1-text-to-video-1080p` | prompt,aspect_ratio,duration |
| HappyHorse 1.0 720P | `happy-horse-1-text-to-video-720p` | prompt,aspect_ratio,duration |
| Veo 4 | `veo-4-text-to-video` | prompt,aspect_ratio,duration |
| Seedance 2 VIP Text to Video 1080P | `sd-2-vip-text-to-video-1080p` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 VIP Text to Video Fast 1080P | `sd-2-vip-text-to-video-fast-1080p` | prompt,aspect_ratio,duration,high_bitrate |
| Kling 3.0 4K | `kling-v3.0-4k-text-to-video` | prompt,aspect_ratio,duration,generate_audio |
| Vidu Q3 Pro | `vidu-q3-pro-text-to-video` | prompt,resolution,aspect_ratio,duration,audio |
| Vidu Q3 Turbo | `vidu-q3-turbo-text-to-video` | prompt,resolution,aspect_ratio,duration,audio |
| Vidu Q2 Pro | `vidu-q2-pro-text-to-video` | prompt,resolution,aspect_ratio,duration,bgm,movement_amplitude |
| Vidu Q2 Turbo | `vidu-q2-turbo-text-to-video` | prompt,resolution,aspect_ratio,duration,bgm,movement_amplitude |
| Seedance 2 VIP Extend | `sd-2-vip-extend` | request_id,prompt,images_list,video_files,audio_files,aspect_ratio,duration,quality |
| Seedance 2 VIP Extend 1080P | `sd-2-vip-extend-1080p` | request_id,prompt,images_list,video_files,audio_files,aspect_ratio,duration,quality |
| Kling 3.0 Omni Standard | `kling-v3.0-omni-standard-text-to-video` | prompt,aspect_ratio,duration,generate_audio |
| Kling 3.0 Omni Pro | `kling-v3.0-omni-pro-text-to-video` | prompt,aspect_ratio,duration,generate_audio |
| Kling 3.0 Omni 4K | `kling-v3.0-omni-4k-text-to-video` | prompt,aspect_ratio,duration |
| Gemini Omni Flash | `gemini-omni-text-to-video` | prompt,duration,resolution,aspect_ratio,audio_ids,seed,character_ids |
| Kling 3.0 Turbo Standard | `kling-v3-turbo-standard-text-to-video` | prompt,aspect_ratio,duration |
| Kling 3.0 Turbo Pro | `kling-v3-turbo-pro-text-to-video` | prompt,aspect_ratio,duration |
| Seedance 2.5 | `seedance-2.5-text-to-video` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 480p | `seedance-2.5-text-to-video-480p` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.0 Mini | `seedance-2-mini-text-to-video` | prompt,aspect_ratio,resolution,duration,generate_audio,high_bitrate |
| HappyHorse 1.1 1080P | `happy-horse-1.1-text-to-video-1080p` | prompt,aspect_ratio,duration |
| HappyHorse 1.1 720P | `happy-horse-1.1-text-to-video-720p` | prompt,aspect_ratio,duration |
| Seedance 2 Mini Omni Reference | `seedance-2-mini-omni-reference` | prompt,images_list,video_files,audio_files,aspect_ratio,resolution,duration,generate_audio,high_bitrate |
| Seedance 2 VIP Text to Video 4K | `sd-2-vip-text-to-video-4k` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2.5 Spicy | `seedance-2.5-spicy-text-to-video` | resolution,generate_audio,prompt,aspect_ratio,duration,high_bitrate,seed |
| Seedance 2 Spicy | `seedance-2-spicy-text-to-video` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 Spicy Text to Video Fast | `seedance-2-spicy-text-to-video-fast` | prompt,aspect_ratio,duration,high_bitrate |
| Seedance 2 Mini Spicy | `seedance-2-mini-spicy-text-to-video` | prompt,aspect_ratio,resolution,duration,generate_audio,high_bitrate |
| MiniMax H3 | `minimax-h3-text-to-video` | prompt,aspect_ratio,resolution,duration |
| MiniMax H3 Base FL2VA | `minimax-h3-open-text-to-video` | prompt,aspect_ratio,resolution,duration,seed |
| FLUX 3 | `flux-3-text-to-video` | prompt,aspect_ratio,resolution,duration,generate_audio |
| Wan 3.0 | `wan3.0-text-to-video` | prompt,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Wan 3.0 Spicy | `wan3.0-spicy-text-to-video` | prompt,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| Seedance 2.5 1080p | `seedance-2.5-text-to-video-1080p` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 4K | `seedance-2.5-text-to-video-4k` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Intl | `seedance-2.5-intl-text-to-video` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Intl 480p | `seedance-2.5-intl-text-to-video-480p` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Spicy 480p | `seedance-2.5-spicy-text-to-video-480p` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Intl 1080p | `seedance-2.5-intl-text-to-video-1080p` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Spicy 1080p | `seedance-2.5-spicy-text-to-video-1080p` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Intl 4K | `seedance-2.5-intl-text-to-video-4k` | prompt,duration,aspect_ratio,seed,high_bitrate |
| Seedance 2.5 Spicy 4K | `seedance-2.5-spicy-text-to-video-4k` | prompt,duration,aspect_ratio,seed,high_bitrate |
| MiniMax H3 Text to Video LoRA | `minimax-h3-text-to-video-lora` | prompt,aspect_ratio,resolution,duration,seed,loras |
| LTX 2.5 | `ltx-2.5-text-to-video` | prompt,duration,aspect_ratio,resolution,seed |
| Wan 3.0 Prime | `wan3.0-prime-text-to-video` | prompt,resolution,aspect_ratio,duration,thinking_mode,enable_audio,seed |
| FLUX 3 Text to Video Draft | `flux-3-text-to-video-draft` | prompt,aspect_ratio,duration,generate_audio |
| Gemini Omni 1.1 Flash | `gemini-omni-flash-1-1-text-to-video` | prompt,image_urls,video_url,trim_start,trim_end,audio_ids,character_ids,duration,aspect_ratio,resolution,seed |

## v2vModels (67)

| Name | Endpoint | Inputs |
|---|---|---|
| AI Video Watermark Remover | `video-watermark-remover` |  |
| Kling 2.6 Standard Motion Control | `kling-v2.6-std-motion-control` | prompt,image_url,video_url,character_orientation |
| Kling 3.0 Standard Motion Control | `kling-v3.0-std-motion-control` | prompt,image_url,video_url,character_orientation,keep_original_sound |
| Kling 3.0 Pro Motion Control | `kling-v3.0-pro-motion-control` | prompt,image_url,video_url,character_orientation,keep_original_sound |
| AI Video Face Swap | `ai-video-face-swap` |  |
| MMAudio v2 | `mmaudio-v2/video-to-video` |  |
| Runway Aleph | `runway-aleph-v2v` |  |
| AI Dance Effects | `ai-dance-effects` |  |
| AI Video Upscaler | `ai-video-upscaler` |  |
| Wan2.2 Edit Video | `wan2.2-edit-video` | resolution |
| HeyGen Video Translate | `heygen-video-translate` |  |
| Topaz Video Upscale | `topaz-video-upscale` |  |
| AI Video Upscaler Pro | `ai-video-upscaler-pro` |  |
| Remix Video | `remix-video` |  |
| Kling O1 Pro Edit | `kling-o1-video-edit` | prompt,video_url,images_list,keep_original_sound,aspect_ratio |
| Kling O1 Pro Edit Fast | `kling-o1-video-edit-fast` | prompt,video_url,images_list,keep_original_sound,aspect_ratio |
| Kling O1 Standard Edit | `kling-o1-standard-video-edit` | prompt,video_url,images_list,keep_original_sound |
| Wan2.2 Spicy Video Extend | `wan2.2-spicy-video-extend` | resolution,duration |
| Seedance v1.5 Pro Video Extend | `seedance-v1.5-pro-video-extend` | resolution,duration,generate_audio,camera_fixed |
| Seedance v1.5 Pro Video Extend Fast | `seedance-v1.5-pro-video-extend-fast` | resolution,duration,generate_audio,camera_fixed |
| Add Video Watermark | `add-video-watermark` |  |
| Seedance 2 Watermark Remover | `seedance-2.0-watermark-remover` |  |
| AI Captions | `ai-captions` |  |
| LTX 2.3 Extend | `ltx-2.3-video-extend` | duration |
| Seedance 2 Video Watermark Remover Pro | `seedance-2-video-watermark-remover-pro` |  |
| PixVerse V6 Extend | `pixverse-v6-extend` | resolution,duration,generate_audio_switch,negative_prompt,style |
| Wan 2.7 Extend | `wan2.7-video-extend` | audio_url,negative_prompt,resolution,duration |
| Wan 2.7 Edit | `wan2.7-video-edit` | negative_prompt,resolution,duration,audio_setting |
| HappyHorse 1.0 Edit 1080P | `happy-horse-1-video-edit-1080p` | prompt,video_url,images_list,audio_setting,seed |
| HappyHorse 1.0 Edit 720P | `happy-horse-1-video-edit-720p` | prompt,video_url,images_list,audio_setting,seed |
| Happy Horse 1.1 Video Edit 1080P | `happy-horse-1.1-video-edit-1080p` | prompt,video_url,images_list,audio_setting,seed |
| Happy Horse 1.1 Video Edit 720P | `happy-horse-1.1-video-edit-720p` | prompt,video_url,images_list,audio_setting,seed |
| Gemini Omni Video Edit | `gemini-omni-video-edit` |  |
| Video Background Remover | `video-background-remover` |  |
| Kling 2.6 Pro Motion Control | `kling-v2.6-pro-motion-control` | prompt,image_url,video_url,character_orientation |
| InfiniteTalk | `infinitetalk-video-to-video` | prompt,video_url,audio_url,resolution |
| Wan2.2 Animate | `wan2.2-animate` | prompt,image_url,video_url,mode,resolution |
| Volcengine Lipsync | `volcengine-video-to-video-lip-sync` | mode,video_url,audio_url,separate_vocal,open_scenedet,align_audio,align_audio_reverse,templ_start_seconds |
| Seedance 2.5 Video Edit | `seedance-2.5-video-edit` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Edit 480p | `seedance-2.5-video-edit-480p` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Edit 1080p | `seedance-2.5-video-edit-1080p` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Edit 4K | `seedance-2.5-video-edit-4k` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Extend | `seedance-2.5-video-extend` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Extend 480p | `seedance-2.5-video-extend-480p` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Extend 1080p | `seedance-2.5-video-extend-1080p` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Video Extend 4K | `seedance-2.5-video-extend-4k` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Edit | `seedance-2.5-intl-video-edit` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Edit | `seedance-2.5-spicy-video-edit` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Edit 480p | `seedance-2.5-intl-video-edit-480p` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Edit 480p | `seedance-2.5-spicy-video-edit-480p` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Edit 1080p | `seedance-2.5-intl-video-edit-1080p` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Edit 1080p | `seedance-2.5-spicy-video-edit-1080p` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Edit 4K | `seedance-2.5-intl-video-edit-4k` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Edit 4K | `seedance-2.5-spicy-video-edit-4k` | prompt,video_url,images_list,audios_list,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Extend | `seedance-2.5-intl-video-extend` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Extend | `seedance-2.5-spicy-video-extend` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Extend 480p | `seedance-2.5-intl-video-extend-480p` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Extend 480p | `seedance-2.5-spicy-video-extend-480p` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Extend 1080p | `seedance-2.5-intl-video-extend-1080p` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Extend 1080p | `seedance-2.5-spicy-video-extend-1080p` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Intl Video Extend 4K | `seedance-2.5-intl-video-extend-4k` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| Seedance 2.5 Spicy Video Extend 4K | `seedance-2.5-spicy-video-extend-4k` | prompt,video_url,last_image,duration,generate_audio,seed,high_bitrate,aspect_ratio |
| FLUX 3 Video Extend | `flux-3-video-extend` | prompt,video_url,aspect_ratio,resolution,duration,generate_audio |
| FLUX Video Upscale | `flux-3-video-upscaler` | video_url,prompt,upscale_factor,creativity |
| FLUX 3 Video Extend Draft | `flux-3-video-extend-draft` | prompt,video_url,aspect_ratio,duration,generate_audio |
| Gemini Omni 1.1 Flash Edit | `gemini-omni-flash-1-1-edit` | prompt,video_url,resolution |
| Depth Anything V2 | `depth-anything` | video_url,image_url |

## videoLipSyncModels (6)

| Name | Endpoint | Inputs |
|---|---|---|
| Sync Lipsync | `sync-lipsync` |  |
| LatentSync | `latentsync-video` |  |
| Creatify Lipsync | `creatify-lipsync` |  |
| Veed Lipsync | `veed-lipsync` |  |
| Infinite Talk V2V | `infinitetalk-video-to-video` | resolution |
| Volcengine Video to Video Lip Sync | `volcengine-video-to-video-lip-sync` | mode |
