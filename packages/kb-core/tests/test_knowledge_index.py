from __future__ import annotations

import unittest
from pathlib import Path

from kb_core.knowledge_index import load_knowledge_index, search_knowledge

REPO = Path(__file__).resolve().parents[3]
INDEX = REPO / "knowledge" / "00-meta" / "search-index.json"


class KnowledgeIndexTests(unittest.TestCase):
    def test_load_knowledge_index_shape(self):
        articles = load_knowledge_index(INDEX, reload=True)
        self.assertGreaterEqual(len(articles), 90)
        sample = articles[0]
        for key in (
            "id",
            "path",
            "title",
            "category",
            "tags",
            "authority",
            "relatedSkills",
            "relatedAgents",
            "summary",
        ):
            self.assertIn(key, sample)
        self.assertLessEqual(len(sample["summary"]), 120)

    def test_search_by_title_and_tags(self):
        hits = search_knowledge("Beat20", {"limit": 5}, index_path=INDEX)
        self.assertTrue(hits)
        self.assertTrue(
            any(
                "beat" in h.id.lower()
                or "beat" in h.path.lower()
                or "节拍" in h.title
                for h in hits
            )
        )

    def test_search_category_filter(self):
        hits = search_knowledge(
            "开篇", {"category": "04-webnovel", "limit": 10}, index_path=INDEX
        )
        self.assertTrue(hits)
        self.assertTrue(all(h.category == "04-webnovel" for h in hits))


if __name__ == "__main__":
    unittest.main()
