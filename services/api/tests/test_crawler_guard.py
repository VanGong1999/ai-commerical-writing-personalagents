from app.crawler.http_util import is_fulltext_url


def test_fulltext_url_refused():
    assert is_fulltext_url("https://example.com/read/12345")
    assert is_fulltext_url("https://example.com/chapter/99")
    assert is_fulltext_url("https://example.com/book?chapterId=7")


def test_rank_page_allowed():
    assert not is_fulltext_url("https://fanqienovel.com/api/rank/list")
    assert not is_fulltext_url("https://example.com/rank")
