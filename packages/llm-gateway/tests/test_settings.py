from llm_gateway import LLMGateway
from llm_gateway.settings import GatewaySettings


def test_defaults(monkeypatch):
    for name in GatewaySettings.model_fields:
        monkeypatch.delenv(name.upper(),raising=False)
    s = GatewaySettings(_env_file=None)
    assert s.llm_default_provider == "minimax"
    assert s.minimax_base_url.startswith("https://")
    assert s.minimax_model == "MiniMax-M3.1-Flash"
    assert s.deepseek_base_url.startswith("https://")
    assert s.deepseek_model


def test_provider_resolution_keeps_deepseek_available(monkeypatch):
    for name in GatewaySettings.model_fields:
        monkeypatch.delenv(name.upper(),raising=False)
    gateway = LLMGateway(
        GatewaySettings(
            _env_file=None,
            minimax_api_key="mini-key",
            deepseek_api_key="deepseek-key",
        )
    )

    minimax = gateway.resolve_provider()
    deepseek = gateway.resolve_provider("deepseek")

    assert minimax[0] == "https://api.minimaxi.com/v1"
    assert minimax[1] == "mini-key"
    assert minimax[2] == "MiniMax-M3.1-Flash"
    assert deepseek[0] == "https://api.deepseek.com"
    assert deepseek[1] == "deepseek-key"
    assert deepseek[2] == "deepseek-flash"
