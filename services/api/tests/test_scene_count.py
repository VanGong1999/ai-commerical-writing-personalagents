import pytest
from app.gates import check_scene_count


def test_one_scene_with_many_actions_and_shots_stays_one_scene():
    body='【场景1】旧车站 内 夜\n'+'\n\n'.join(f'△林晚检查第{i+1}件物品。\n分镜{i+1}：手部特写。' for i in range(20))
    result=check_scene_count(body)
    assert result['result']=='pass'
    assert '1' in result['message']


@pytest.mark.parametrize('headers',[
    [f'场{i+1}：旧站' for i in range(4)],
    [f'场景{i+1}：旧站' for i in range(4)],
    [f'场景{i+1}｜旧站' for i in range(4)],
    ['第一场：旧站','第二场：街道','第三场：仓库','第四场：月台'],
    [f'1-{i+1} 旧站 内 夜' for i in range(4)],
    [f'{i+1}|旧站|内|夜' for i in range(4)],
])
def test_four_explicit_scene_headers_exceed_limit(headers):
    assert check_scene_count('\n△动作。\n'.join(headers))['result']=='fail'


@pytest.mark.parametrize('text',['','\n\n'.join(['自然段。']*20),'\n\n'.join(['△动作。\n分镜：特写。']*20),'场景气氛很紧张。\n场面陷入沉默。\n场外传来声音。','1-1 特写\n1-2 中景\n1-3 全景\n1-4 近景'])
def test_no_explicit_scene_headers_requires_human_review(text):
    assert check_scene_count(text)['result']=='warn'


@pytest.mark.parametrize('text',['场景1｜夜·月台\n△走近。','1-1 内 旧站 夜\n△走近。','### 场景：旧站\n△走近。','【景1】旧站\n△走近。'])
def test_canonical_scene_headers_are_recognized(text):
    assert check_scene_count(text)['result']=='pass'
