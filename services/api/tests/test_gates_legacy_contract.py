"""Frozen pre-migration outputs catch drift without retaining a second engine."""
import copy
import json
from pathlib import Path

import pytest

from app.gates import run_gate_battery

CONTRACT = json.loads((Path(__file__).parent / 'fixtures/gates_legacy_contract.json').read_text())

# Explicit corrections to old drift. Keep the original fixture unchanged so a
# future rule change cannot silently refresh away the migration evidence.
CORRECTIONS = {
    ('PromptLock', 'empty'): [('prompt_lock_hash', 'fail')],  # Invalid input now fails instead of KeyError.
    ('PromptLock', 'full'): [('prompt_lock_hash', 'pass'), ('required_phrases', 'pass')],
    ('Budget', 'small_budget_rounding'): [('budget', 'pass')],  # 1/2 is below 90%; no integer truncation.
    ('PaywallCoverage', 'null_slots'): [('paywall_coverage', 'fail')],  # Empty slots must not satisfy coverage.
}


def case_id(row):
    return f"{row['name']}-{row.get('label', row.get('profile'))}"


@pytest.mark.parametrize('row', CONTRACT['cases'], ids=case_id)
def test_pre_migration_gate_verdicts(row):
    payload = copy.deepcopy(CONTRACT['profiles'][row['profile']] if 'profile' in row else row['payload'])
    key = (row['name'], row.get('label', row.get('profile')))
    expected = CORRECTIONS.get(key)
    if expected is None:
        assert 'expected_error' not in row, 'Unreviewed legacy exception contract'
        expected = [(check['id'], check['result']) for check in row['expected']]
    actual = run_gate_battery(row['name'], **payload)
    assert [(check['id'], check['result']) for check in actual] == expected
    assert all(isinstance(check['message'], str) and check['name'] for check in actual)
