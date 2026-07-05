# GAIC Error Code Reference

On-demand reference for `/sn-aia-trace-analyzer` Phase 2 Step 4 (Inspect LLM Logs). When
`error_code` is present on a `sys_generative_ai_log` record, look it up here.

**Pre-Processing Errors (100xxx):**

| Code | Name | Description | Workaround |
|---|---|---|---|
| `100001` | Min Word Count restriction | Source doesn't have minimum words required | Check Min Word Count in `sys_generative_ai_config` for the definition. Set to -1 to bypass. |
| `100002` | Missing `_meta` property | JSON input to GAIC preprocessor missing `_meta` key | Common when executing GAIC subflow directly without OneExtend API. Check flow context for malformed JSON. In HI/BT1 clones, Gen AI FDIH subflows may not install properly. |
| `100003` | Missing mandatory attributes | Request missing a capability attribute marked mandatory | Check `sys_one_extend_capability` → OE Capability Attributes tab for mandatory attributes. |
| `100004` | Error preparing request | Error while preparing the request | Common when active prompt configuration not found. Verify prompt config exists and is active. |
| `100005` | Request validator error | Error in pre-processor request validators | Check `sys_generative_ai_request_validator` for the capability definition. |
| `100006` | Data Privacy API error | PII masking failed during preprocessing | Refer to Data Privacy API error codes documentation. |

**LLM Request Errors (200xxx):**

| Code | Name | Description | Workaround |
|---|---|---|---|
| `200000` | LLM execution error | Error at the LLM execution level | Check: (1) Host URL in connection is correct, (2) API deployment exists and API key is valid, (3) If using NowLLM, ensure toolkit URL is not in `connection_url`. May need to set `is_internal=false` on `sys_alias`. |
| `200001` | Invalid JSON from LLM | LLM response not JSON but `json_format_supported` is enabled | Check `sys_generative_ai_config` — if `json_format_supported` is enabled, LLM must return valid JSON. Consider disabling this flag or fixing the prompt. |

**Post-Processing Errors (300xxx):**

| Code | Name | Description | Workaround |
|---|---|---|---|
| `300000` | Guardrail moderation flagged | Moderation checks flagged by Guardrails | Check guardrail response for flagged categories. Zero-day checks (regex, semantic, FSD) failure also results in this code. Check `sys_generative_ai_metric` for details. |
| `300001` | Trust Builder error | Error in Trust Builder Post-Processor | Check `GenAITrustBuilderResponsePostProcessor` action in Flow Designer. |
| `300002` | Response validation error | Error validating response | Check `sys_generative_ai_response_validator` for the capability definition. |
| `300100` | Hallucination threshold exceeded | Offensiveness score exceeds threshold | Check `sn_generative_ai.hallucination` threshold sysprop. Review `GenAITrustBuilderResponsePostProcessor`. |
| `300200` | Offensiveness moderation flagged | Offensiveness check flagged | Check `sys_generative_ai_metric` for Offensiveness raw response and flagged categories. |
| `300300` | Prompt Injection detected | Prompt injection check flagged | Check `sys_generative_ai_metric` for Prompt Injection raw response and flagged categories. |

**Execution Pipeline / External Errors (400xxx):**

| Code | Name | Description | Workaround |
|---|---|---|---|
| `400001` | Subflow execution failure | Error in subflow nodes or exception before completion | Check flow execution logs for root cause. |
| `400002` | Error outside GAIC process | Original log changed from success to error via scriptable API | Check what called `sn_one_extend.GenerativeAIUtility.updateGenerativeAILog()` to understand why. |
