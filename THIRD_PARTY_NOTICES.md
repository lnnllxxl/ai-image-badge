# Third-party notices

This extension bundles the following third-party components and model weights.

- **Community Forensics image classifier** — Jeongsoo Park and Andrew Owens; Hugging Face conversion by Borderless. The pinned ONNX model is `buildborderless/CommunityForensics-DeepfakeDet-ViT@ac6ee457bea9`. See `third_party/community-forensics-LICENSE.txt`.
- **Distilled ViT image classifier (Q4 ONNX)** — Jacob Allessio; ONNX conversion by ONNX Community. The pinned model is `onnx-community/ai-image-detect-distilled-ONNX@7f067e23521e`, file `onnx/model_q4.onnx`, SHA-256 `d6a0ad89d7fd55ee9e282d9cefd466d3c17d2c5ad1baec2ed6192494e3618247`. Licensed under MIT; see `third_party/distilled-vit-MIT-LICENSE.txt`.
- **CapCheck ViT-Base image classifier (Q4 ONNX)** — CapCheck model and ONNX Community conversion. The pinned model is `onnx-community/ai-image-detection-ONNX@e3cfe99f2841`, file `onnx/model_q4.onnx`, SHA-256 `28c7f06d5aa87bc7e023c023eab1fbf473deef54e9c62f9838a99e50422810ec`. Licensed under Apache-2.0; see `third_party/capcheck-Apache-2.0-LICENSE.txt`.
- **Local AI Image Detector preprocessing and calibration approach** — Copyright (c) 2026 agentatwork. Portions of `ml/preprocess.js` and `ml/model-detector.js`, and the two-view calibration configuration, are derived from this project. See `third_party/local-ai-image-detector-LICENSE.txt`.
- **ONNX Runtime Web 1.23.0** — Copyright (c) Microsoft Corporation. See `third_party/onnxruntime-LICENSE.txt`.

Project sources:

- https://github.com/JeongsooP/Community-Forensics
- https://huggingface.co/buildborderless/CommunityForensics-DeepfakeDet-ViT
- https://huggingface.co/onnx-community/ai-image-detect-distilled-ONNX
- https://huggingface.co/onnx-community/ai-image-detection-ONNX
- https://github.com/agentatwork/local-ai-image-detector
- https://github.com/microsoft/onnxruntime
