"""Native smoke test against a running Lunar development build (English UI).

Import an EPUB first, keep Metro running, then:
python apps/mobile/tests/e2e/reading-statistics.py --serial emulator-5554
No application data is cleared or seeded. Evidence is written outside the repo.
"""
import argparse
import json
import pathlib
import re
import sqlite3
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--serial', required=True)
parser.add_argument('--uiautomator2', action='store_true', help='Use uiautomator2 for readers with continuous accessibility updates')
parser.add_argument('--book-title', default='')
parser.add_argument('--development-url', default='lunar-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081')
parser.add_argument('--package', default='com.lunarain_079.lunar.dev')
args = parser.parse_args()
output = pathlib.Path(tempfile.mkdtemp(prefix='lunar-statistics-e2e-'))
device = None
if args.uiautomator2:
    import uiautomator2
    device = uiautomator2.connect(args.serial)
    device.jsonrpc.setConfigurator({'waitForIdleTimeout': 0, 'waitForSelectorTimeout': 0})


def adb(*arguments):
    return subprocess.check_output(['adb', '-s', args.serial, *arguments], timeout=35)


def ui():
    if device is not None:
        return list(ET.fromstring(device.dump_hierarchy()).iter('node'))
    adb('shell', 'uiautomator', 'dump', '/sdcard/lunar-statistics-ui.xml')
    return list(ET.fromstring(adb('exec-out', 'cat', '/sdcard/lunar-statistics-ui.xml')).iter('node'))


def wait_for(predicate, timeout=50):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        nodes = ui()
        found = next((node for node in nodes if predicate(node)), None)
        if found is not None:
            return found
        time.sleep(0.5)
    raise AssertionError('Expected native UI did not appear')


def description(value):
    return lambda node: node.get('content-desc') == value


def tap(node):
    left, top, right, bottom = map(int, re.findall(r'\d+', node.get('bounds')))
    assert right > left and bottom > top, 'Target is outside the viewport'
    adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))


def screenshot(name):
    (output / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))


def database():
    # Copy the WAL too: current checkpoints may not yet have reached the main file.
    snapshot = pathlib.Path(tempfile.mkdtemp(dir=output))
    for name in ('lunar.db', 'lunar.db-wal'):
        result = subprocess.run(['adb', '-s', args.serial, 'exec-out', 'run-as', args.package,
                                 'cat', 'files/SQLite/' + name], capture_output=True, timeout=15)
        if result.returncode == 0:
            (snapshot / name).write_bytes(result.stdout)
    with sqlite3.connect(snapshot / 'lunar.db') as connection:
        return connection.execute('SELECT id, book_id, started_at, ended_at FROM reading_sessions ORDER BY id').fetchall()


def total(rows):
    return sum(end - start for _, _, start, end in rows)


def library():
    nodes = ui()
    back = next((node for node in nodes if node.get('content-desc') == 'Back to library'), None)
    if back is not None:
        tap(back)
    elif not any(node.get('content-desc') == 'Library' for node in nodes):
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        tap(wait_for(description('Back to library')))
    tap(wait_for(description('Library')))
    time.sleep(2)


def statistics():
    tap(wait_for(description('Statistics')))
    time.sleep(1)
    for _ in range(3):
        adb('shell', 'input', 'swipe', '20', '500', '20', '2000', '400')
    wait_for(lambda node: node.get('text') in ('Reading activity', 'Total reading time', 'By book'))


print('Checking statistics and opening a real book', flush=True)
library()
statistics()
screenshot('overview-before')
# Reach the real book card using the page's vertical scrolling.
for _ in range(5):
    nodes = ui()
    card = next((node for node in nodes if node.get('content-desc', '').startswith('Continue reading ')
                 and args.book_title in node.get('content-desc', '')
                 and int(re.findall(r'\d+', node.get('bounds'))[3]) < 2185), None)
    if card is not None:
        break
    adb('shell', 'input', 'swipe', '20', '1900', '20', '850', '450')
else:
    raise AssertionError('Import an EPUB before running this test')
screenshot('book-card')
before = total(database())
tap(card)
wait_for(lambda node: node.get('content-desc', '').startswith('Reading page, ')
         and 'Calculating' not in node.get('content-desc', ''))
print('Reader ready; waiting for a persisted foreground checkpoint', flush=True)
for _ in range(45):
    if total(database()) >= before + 10_000:
        break
    time.sleep(2)
else:
    raise AssertionError('Foreground reading did not reach a persisted checkpoint')
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
# Allow the queued final foreground checkpoint to reach SQLite before comparing.
time.sleep(10)
background = database()
print('Checking background exclusion', flush=True)
assert total(background) >= before + 10_000, 'Foreground reading was not recorded'
for _ in range(4):
    time.sleep(12)
    next_snapshot = database()
    if next_snapshot == background:
        break
    background = next_snapshot  # The queued final checkpoint may still be draining.
else:
    raise AssertionError('Reading time continued increasing in the background')
print('Resuming application', flush=True)
adb('shell', 'am', 'start', '-n', args.package + '/.MainActivity')
wait_for(lambda node: node.get('content-desc', '').startswith('Reading page, '))
# Wait for resumed reading to reach its checkpoint before navigating away.
for _ in range(45):
    if len(database()) > len(background) and total(database()) > total(background):
        break
    time.sleep(2)
else:
    raise AssertionError('Resumed reading was not saved')
library()
statistics()
time.sleep(2)
after = database()
assert len(after) > len(background), 'Resuming must create a distinct reading session'
assert total(after) > total(background), 'Resumed reading was not saved'
# The visible total must be derived from the persisted sessions.
seconds = total(after) // 1000
formatted = (f'{seconds // 3600} hr {(seconds // 60) % 60} min' if seconds >= 3600
             else f'{seconds // 60} min {seconds % 60} sec')
assert any(node.get('text') == formatted for node in ui()), 'Overview differs from saved reading time'
screenshot('overview-after')
adb('shell', 'am', 'force-stop', args.package)
print('Restarting development client with its Metro URL', flush=True)
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', args.development_url)
wait_for(lambda node: node.get('content-desc') in ('Library', 'Back to library')
         or node.get('content-desc', '').startswith('Reading page, '), timeout=120)
assert set(map(tuple, after)).issubset(set(map(tuple, database()))), 'Reading records did not survive process restart'
library()
statistics()
screenshot('after-restart')
(output / 'result.json').write_text(json.dumps({'passed': True, 'beforeMs': before,
    'backgroundMs': total(background), 'afterMs': total(after), 'sessions': len(after)}, indent=2))
print(f'PASS: foreground, background exclusion, resume, statistics/book navigation, persisted UI total and restart. Evidence: {output}')
