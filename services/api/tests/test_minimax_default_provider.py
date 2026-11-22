from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import crypto
from app.models import ProviderConfig
from app.seed import ensure_minimax_default_provider
from app.settings import Settings


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_ensure_minimax_dedupes_without_replacing_explicit_deepseek_default(monkeypatch):
    engine = _engine()
    monkeypatch.setattr(crypto, "decrypt_secret", lambda value: "real-key" if value in {"enc-a", "enc-ds"} else "")
    monkeypatch.setattr(crypto, "encrypt_secret", lambda plain: f"enc:{plain}")
    monkeypatch.setattr(crypto, "mask_secret", lambda plain: f"{plain[:2]}…")
    monkeypatch.setattr(
        "app.seed.get_settings",
        lambda: Settings(
            llm_default_provider="minimax",
            minimax_api_key="env-key",
            minimax_base_url="https://api.minimaxi.com/v1",
            minimax_model="MiniMax-M3.1-Flash",
            deepseek_base_url="https://api.deepseek.com",
            deepseek_model="deepseek-flash",
        ),
    )

    with Session(engine) as session:
        session.add(
            ProviderConfig(
                name="DeepSeek",
                base_url="https://api.deepseek.com",
                api_key_enc="enc-ds",
                models=["deepseek-flash"],
                selected_model="deepseek-flash",
                enabled=True,
                is_default=True,
            )
        )
        session.add(
            ProviderConfig(
                name="MiniMax",
                base_url="https://api.minimaxi.com/v1",
                api_key_enc="enc-a",
                models=["MiniMax-M3.1-Flash"],
                selected_model="MiniMax-M3.1-Flash",
                enabled=True,
                is_default=False,
            )
        )
        session.add(
            ProviderConfig(
                name="MiniMax",
                base_url="https://api.minimaxi.com/v1",
                api_key_enc="",
                models=["MiniMax-M3.1-Flash"],
                selected_model="MiniMax-M3.1-Flash",
                enabled=True,
                is_default=False,
            )
        )
        session.commit()
        out = ensure_minimax_default_provider(session)
        rows = list(session.exec(select(ProviderConfig)))

    assert out["skipped"] is False
    assert out["configured"] is True
    minimax = [r for r in rows if r.name == "MiniMax"]
    deepseek = [r for r in rows if r.name == "DeepSeek"]
    assert len(minimax) == 1
    assert minimax[0].is_default is False
    assert minimax[0].enabled is True
    assert deepseek[0].is_default is True
    assert out["defaultProviderId"] == deepseek[0].id


def _settings(monkeypatch):
    monkeypatch.setattr(crypto, "decrypt_secret", lambda value: value[4:] if value.startswith("enc:") else "")
    monkeypatch.setattr(crypto, "encrypt_secret", lambda plain: f"enc:{plain}")
    monkeypatch.setattr(crypto, "mask_secret", lambda plain: "masked")
    monkeypatch.setattr("app.seed.get_settings", lambda: Settings(llm_default_provider="minimax",minimax_api_key="env-key",minimax_base_url="https://api.minimaxi.com/v1",minimax_model="MiniMax-M3.1-Flash"))


def test_empty_database_bootstraps_minimax_once(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        first=ensure_minimax_default_provider(session)
        second=ensure_minimax_default_provider(session)
        rows=list(session.exec(select(ProviderConfig)))
        assert len(rows)==1
        row=rows[0]
        assert first['defaultProviderId']==second['defaultProviderId']==row.id
        assert row.is_default and row.enabled
        assert row.selected_model=='MiniMax-M3.1-Flash'
        assert row.base_url=='https://api.minimaxi.com/v1'
        assert row.api_key_enc=='enc:env-key'


def test_existing_minimax_endpoint_model_key_and_disabled_choice_survive_restarts(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        row=ProviderConfig(name='MiniMax',base_url='https://user-proxy.example/v1',selected_model='custom-model',models=['custom-model'],api_key_enc='enc:user-key',enabled=False,is_default=False)
        session.add(row);session.commit()
        for _ in range(2):
            result=ensure_minimax_default_provider(session)
            session.refresh(row)
            assert row.base_url=='https://user-proxy.example/v1'
            assert row.selected_model=='custom-model'
            assert row.models==['custom-model']
            assert row.api_key_enc=='enc:user-key'
            assert row.enabled is False and row.is_default is False
            assert result['defaultProviderId'] is None


def test_environment_only_fills_missing_fields_without_changing_valid_model(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        row=ProviderConfig(name='MiniMax',base_url='',selected_model='user-model',models=['user-model'],api_key_enc='',enabled=True,is_default=True)
        session.add(row);session.commit()
        ensure_minimax_default_provider(session);session.refresh(row)
        assert row.base_url=='https://api.minimaxi.com/v1'
        assert row.selected_model=='user-model' and row.models==['user-model']
        assert row.api_key_enc=='enc:env-key'


def test_duplicate_preserves_explicit_default_settings_and_borrows_missing_key(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        keyed=ProviderConfig(name='MiniMax',base_url='https://api.minimaxi.com/v1',selected_model='old-model',models=['old-model'],api_key_enc='enc:stored-key',enabled=True,is_default=False)
        chosen=ProviderConfig(name='MiniMax',base_url='https://chosen.example/v1',selected_model='chosen-model',models=['chosen-model'],api_key_enc='',enabled=True,is_default=True)
        session.add(keyed);session.add(chosen);session.commit()
        ensure_minimax_default_provider(session)
        rows=list(session.exec(select(ProviderConfig)))
        assert len(rows)==1 and rows[0].id==chosen.id
        assert rows[0].base_url=='https://chosen.example/v1' and rows[0].selected_model=='chosen-model'
        assert rows[0].api_key_enc=='enc:stored-key' and rows[0].is_default


def test_narrow_misrouted_deepseek_migration_keeps_user_default(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        row=ProviderConfig(name='DeepSeek',base_url='https://api.minimaxi.com/v1',selected_model='MiniMax-M3.1-Flash',models=['MiniMax-M3.1-Flash'],api_key_enc='enc:ds-key',enabled=True,is_default=True)
        session.add(row);session.commit()
        ensure_minimax_default_provider(session);session.refresh(row)
        assert row.base_url=='https://api.deepseek.com'
        assert row.selected_model=='deepseek-flash'
        assert row.enabled and row.is_default and row.api_key_enc=='enc:ds-key'


def test_valid_minimax_custom_default_is_not_reset_to_environment(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        row=ProviderConfig(name='MiniMax',base_url='https://chosen.example/v1',selected_model='user-model',models=['user-model'],api_key_enc='enc:user-key',enabled=True,is_default=True)
        session.add(row);session.commit()
        for _ in range(2):
            result=ensure_minimax_default_provider(session);session.refresh(row)
            assert result['defaultProviderId']==row.id
            assert row.base_url=='https://chosen.example/v1'
            assert row.selected_model=='user-model' and row.models==['user-model']
            assert row.api_key_enc=='enc:user-key' and row.enabled and row.is_default


def test_missing_minimax_does_not_take_over_custom_deepseek_default(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        row=ProviderConfig(name='DeepSeek',base_url='https://chosen-ds.example/v1',selected_model='ds-custom',models=['ds-custom'],api_key_enc='enc:ds-user-key',enabled=True,is_default=True)
        session.add(row);session.commit()
        ensure_minimax_default_provider(session);session.refresh(row)
        minimax=session.exec(select(ProviderConfig).where(ProviderConfig.name=='MiniMax')).one()
        assert minimax.is_default is False
        assert row.base_url=='https://chosen-ds.example/v1' and row.selected_model=='ds-custom'
        assert row.is_default and row.api_key_enc=='enc:ds-user-key'


def test_misrouted_deepseek_url_fix_does_not_replace_custom_model(monkeypatch):
    _settings(monkeypatch)
    with Session(_engine()) as session:
        row=ProviderConfig(name='DeepSeek',base_url='https://api.minimaxi.com/v1',selected_model='ds-custom',models=['ds-custom'],api_key_enc='enc:ds-user-key',enabled=False,is_default=False)
        session.add(row);session.commit()
        ensure_minimax_default_provider(session);session.refresh(row)
        assert row.base_url=='https://api.deepseek.com'
        assert row.selected_model=='ds-custom' and row.models==['ds-custom']
        assert row.enabled is False and row.api_key_enc=='enc:ds-user-key'
