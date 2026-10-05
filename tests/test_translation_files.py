"""Translation files preserve HA config/action keys while changing UI text."""
import json
from pathlib import Path
import unittest

COMPONENT = Path(__file__).resolve().parents[1] / 'custom_components' / 'taylors3d'


def leaves(value, prefix=()):
    if isinstance(value, dict):
        return {path: leaf for key, child in value.items() for path, leaf in leaves(child, prefix + (key,)).items()}
    return {prefix: value}


class IntegrationTranslationFiles(unittest.TestCase):
    def setUp(self):
        self.source = json.loads((COMPONENT / 'strings.json').read_text(encoding='utf-8-sig'))
        self.packs = {language: json.loads((COMPONENT / 'translations' / f'{language}.json').read_text(encoding='utf-8-sig'))
                      for language in ('en', 'de', 'fr', 'es')}

    def test_english_matches_authoritative_source_strings(self):
        self.assertEqual(self.packs['en'], self.source)

    def test_language_files_keep_all_config_service_field_and_selector_paths(self):
        expected = leaves(self.source)
        for language, pack in self.packs.items():
            with self.subTest(language=language):
                actual = leaves(pack)
                self.assertEqual(set(actual), set(expected))
                self.assertTrue(all(isinstance(value, str) and value.strip() for value in actual.values()))

    def test_brand_and_machine_identifiers_stay_exact(self):
        for language, pack in self.packs.items():
            with self.subTest(language=language):
                self.assertEqual(pack['config']['step']['user']['title'], "Taylor's 3D")
                self.assertEqual(set(pack['services']), {'select_view'})
                self.assertEqual(set(pack['services']['select_view']['fields']), {'layout_key', 'preset', 'panel', 'card_id', 'mode', 'return_after'})
                self.assertEqual(set(pack['selector']['camera_mode']['options']), {'3d', 'top'})
                self.assertEqual(pack['selector']['camera_mode']['options']['3d'], '3D')
                for name in ('layout_key', 'automation_panel', 'automation_card_id'):
                    self.assertIn(name, json.dumps(pack, ensure_ascii=False))

    def test_translates_the_setup_and_action_controls(self):
        for language in ('de', 'fr', 'es'):
            with self.subTest(language=language):
                self.assertNotEqual(self.packs[language]['config']['step']['user']['description'], self.source['config']['step']['user']['description'])
                self.assertNotEqual(self.packs[language]['services']['select_view']['name'], self.source['services']['select_view']['name'])


if __name__ == '__main__':
    unittest.main()
