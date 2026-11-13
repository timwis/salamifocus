"""Check the importer fixture against independently saved native OmniFocus records."""
import base64
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).parent
fixture = json.loads((HERE / 'fixtures/representative.json').read_text())
assert fixture['format'] == 'salamifocus.omnifocus-export' and fixture['version'] == 1
assert [len(fixture[k]) for k in ('folders', 'projects', 'tags', 'tasks')] == [2, 6, 3, 19]
ns = {'o': 'http://www.omnigroup.com/namespace/OmniFocus/v2'}
with zipfile.ZipFile(HERE / 'fixtures/representative.ofocus.zip') as archive:
    records = {}
    for name in sorted(archive.namelist()):
        if name.endswith('.zip') and '/data/' not in name:
            with zipfile.ZipFile(io.BytesIO(archive.read(name))) as transaction:
                root = ET.fromstring(transaction.read('contents.xml'))
                for record in root:
                    if record.get('id'):
                        records[(record.tag.split('}')[-1], record.get('id'))] = record
    for collection, kind in [('folders', 'folder'), ('tags', 'context'), ('tasks', 'task')]:
        for item in fixture[collection]:
            record = records[kind, item['id']]
            assert record.findtext('o:name', namespaces=ns) == item['name']
    tasks = {t['name']: t for t in fixture['tasks']}
    task_ids = {t['id'] for t in fixture['tasks']}
    tag_ids = {t['id'] for t in fixture['tags']}
    for t in fixture['tasks']:
        assert set(t['childIds']) <= task_ids
        assert set(t['tagIds']) <= tag_ids
        assert t['parentTaskId'] is None or t['parentTaskId'] in task_ids
    for t in fixture['tasks']:
        record = records['task', t['id']]
        assert record.find('o:task', ns).get('idref') == t['parentTaskId']
        assert (record.findtext('o:flagged', namespaces=ns) == 'true') == t['flagged']
    for f in fixture['folders']:
        assert records['folder', f['id']].find('o:folder', ns).get('idref') == f['parentFolderId']
    for tag in fixture['tags']:
        assert records['context', tag['id']].find('o:context', ns).get('idref') == tag['parentTagId']
    child = tasks['Cut the paper windows']
    assert child['parentTaskId'] == tasks['Assemble the lantern']['id']
    native_tags = {r.find('o:context', ns).get('idref') for (kind, _), r in records.items() if kind == 'task-to-tag' and r.find('o:task', ns).get('idref') == child['id']}
    assert set(child['tagIds']) == native_tags
    assert len(child['tagIds']) == 2 and child['flagged']
    assert child['deferDate'] == '2026-11-15T09:30:00.000Z'
    assert child['dueDate'] == '2026-11-20T17:45:00.000Z'
    record = records['task', child['id']]
    assert record.findtext('o:start', namespaces=ns) == '2026-11-15T09:30:00.000'
    assert record.findtext('o:due', namespaces=ns) == '2026-11-20T17:45:00.000'
    assert tasks['Sketch the lighthouse']['completionDate'] == '2026-11-10T12:00:00.000Z'
    assert tasks['Order glass windows']['dropDate'] == '2026-11-11T12:00:00.000Z'
    assert tasks['Pack spare paper']['completionDate'] is None
    assert tasks['Pack spare paper']['effectiveCompletedDate'] is not None
    assert tasks['Reserve a venue']['dropDate'] is None
    assert tasks['Reserve a venue']['effectiveDropDate'] is not None
    for name, mode, anchor in [('Check the studio smoke alarm', 'Regularly', 'DueDate'), ('Oil the model gears', 'FromCompletion', 'DeferDate')]:
        t = tasks[name]
        rule = t['repetitionRule']
        assert (rule['ruleString'], rule['scheduleType'], rule['anchorDateKey']) == ('FREQ=MONTHLY', mode, anchor)
        assert records['task', t['id']].findtext('o:repetition-rule', namespaces=ns) == rule['ruleString']
    attachment = child['attachments'][0]
    assert base64.b64decode(attachment['base64']) == b'Fictional lighthouse attachment.\n'
    attachment_record = next(r for (kind, _), r in records.items() if kind == 'attachment')
    identifier = attachment_record.findtext('o:data-identifier', namespaces=ns)
    name = next(n for n in archive.namelist() if n.endswith('/' + identifier + '.zip'))
    with zipfile.ZipFile(io.BytesIO(archive.read(name))) as data:
        assert any(data.read(n) == base64.b64decode(attachment['base64']) for n in data.namelist() if not n.endswith('/'))
projects = {p['name']: p for p in fixture['projects']}
assert projects['Workshop errands']['singleActionList']
assert projects['Winter sculpture']['status'] == 'OnHold'
assert projects['Sequential demonstration']['sequential']
assert len(fixture['inboxIds']) == 1
print('Verified: native identities/names, hierarchy references, dates, lifecycle inheritance, monthly modes/anchors, attachment bytes, project types, Inbox.')
