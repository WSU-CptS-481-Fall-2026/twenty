import dataclasses
import importlib.machinery
import importlib.util
import json
import os
import pty
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('twenty_dev', str(Path(__file__).with_name('twenty-dev')))
spec = importlib.util.spec_from_loader(loader.name, loader)
dev = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dev
loader.exec_module(dev)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.worktree = dev.Worktree(root, 'test', root, 'twenty-test')

    def tearDown(self):
        self.temp.cleanup()

    def test_port_is_available_immediately_after_server_closes_connection(self):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            with socket.create_connection(('127.0.0.1', port)) as client:
                connection, _ = listener.accept()
                connection.close()
                self.assertEqual(client.recv(1), b'')
        self.assertTrue(dev.available(port))

    def test_port_with_live_reusable_listener_is_unavailable(self):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            self.assertFalse(dev.available(listener.getsockname()[1]))

    def test_manifest_refuses_other_worktree_and_duplicate_ports(self):
        state = dev.new_state(self.worktree)
        dev.save(self.worktree, state)
        self.assertEqual(dev.load(self.worktree), state)
        state['root'] = '/another/worktree'
        dev.save(self.worktree, state)
        with self.assertRaises(dev.Failure):
            dev.load(self.worktree)
        state['root'] = str(self.worktree.root)
        state['ports']['redis'] = state['ports']['postgres']
        dev.save(self.worktree, state)
        with self.assertRaises(dev.Failure):
            dev.load(self.worktree)

    def test_dotenv_replaces_owned_duplicate_keys_preserves_other_settings(self):
        path = self.worktree.root / '.env'
        path.write_text('# user setting\nOTHER=value\nNODE_PORT=3000\nexport NODE_PORT=4000\n')
        dev.dotenv(path, {'NODE_PORT': 51000})
        self.assertEqual(path.read_text(), '# user setting\nOTHER=value\nNODE_PORT=51000\n')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_compose_is_isolated_and_loopback_only(self):
        state = dev.new_state(self.worktree)
        dev.compose_file(self.worktree, state)
        doc = json.loads((self.worktree.root / 'compose.json').read_text())
        self.assertEqual(set(doc['services']), {'postgres', 'redis'})
        for role, service in doc['services'].items():
            self.assertTrue(service['ports'][0].startswith('127.0.0.1:'))
            self.assertEqual(service['labels']['twenty.worktree'], str(self.worktree.root))
            self.assertEqual(service['volumes'][0].split(':')[0], role + '-data')
        self.assertEqual((self.worktree.root / 'compose.json').stat().st_mode & 0o777, 0o600)

    def test_foreign_resource_is_rejected_before_mutation(self):
        foreign = [{'Labels': {'com.docker.compose.project': 'another-project'}}]
        with patch.object(dev, 'run', return_value=json.dumps(foreign)) as run:
            with self.assertRaises(dev.Failure):
                dev.owned(self.worktree, 'volume', 'twenty-test_postgres-data')
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][:3], ['docker', 'volume', 'inspect'])

    def test_mismatched_process_identity_does_not_signal_live_process(self):
        process = subprocess.Popen(['sleep', '60'], start_new_session=True)
        try:
            record = dataclasses.asdict(dev.identity(process.pid))
            record['start_ticks'] += 1
            dev.halt(record)
            self.assertIsNone(process.poll())
        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_owned_supervisor_stops_its_child(self):
        process = subprocess.Popen([sys.executable, str(Path(dev.__file__)), '--supervise', 'sleep', '60'],
                                   start_new_session=True)
        try:
            record = dataclasses.asdict(dev.identity(process.pid))
            time.sleep(0.2)
            self.assertTrue(dev.alive(record))
            dev.halt(record)
            process.wait(timeout=5)
            self.assertFalse(dev.alive(record))
            self.assertEqual(dev.group_members(process.pid), [])
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()

    def test_setup_command_does_not_inherit_action_terminal(self):
        master, terminal = pty.openpty()
        original_stdin = os.dup(0)
        try:
            os.dup2(terminal, 0)
            result = dev.run([sys.executable, '-c',
                              "import os, sys; print(os.isatty(0)); print(repr(sys.stdin.read()))"],
                             timeout=2)
        finally:
            os.dup2(original_stdin, 0)
            for descriptor in (original_stdin, terminal, master):
                os.close(descriptor)
        self.assertEqual(result, "False\n''\n")

    def test_subprocess_failure_keeps_diagnostic_without_credential(self):
        with self.assertRaises(dev.Failure) as error:
            dev.run([sys.executable, '-c', "print('connection postgres://user:private@host/db'); print('useful failure'); raise SystemExit(1)"])
        self.assertIn('useful failure', str(error.exception))
        self.assertNotIn('private', str(error.exception))

    def test_interrupted_bootstrap_never_reseeds(self):
        state = dev.new_state(self.worktree)
        state['phase'] = 'seeding'
        with patch.object(dev, 'validate_resources'), patch.object(dev, 'compose_file'), \
             patch.object(dev, 'environment', return_value={}), patch.object(dev, 'prepare'), \
             patch.object(dev, 'compose', return_value='PONG'), patch.object(dev, 'task') as task:
            with self.assertRaisesRegex(dev.Failure, 'Interrupted database seeding'):
                dev.start(self.worktree, state)
            task.assert_not_called()

    def test_source_fingerprint_includes_new_files_but_not_ignored_outputs(self):
        subprocess.run(['git', 'init', '-q', str(self.worktree.root)], check=True)
        (self.worktree.root / '.gitignore').write_text('dist/\n')
        initial = dev.fingerprint(self.worktree)
        (self.worktree.root / 'new-source.ts').write_text('export const value = 1;\n')
        changed = dev.fingerprint(self.worktree)
        self.assertNotEqual(initial, changed)
        (self.worktree.root / 'dist').mkdir()
        (self.worktree.root / 'dist/generated.js').write_text('generated output')
        self.assertEqual(changed, dev.fingerprint(self.worktree))

    def test_focused_tests_execute_installed_runner_with_file_and_scope(self):
        root = self.worktree.root
        binaries = root / 'node_modules/.bin'
        binaries.mkdir(parents=True)
        for runner in ('jest', 'vitest'):
            executable = binaries / runner
            executable.write_text('#!' + sys.executable + '\n'
                                  'import json, os, sys\n'
                                  'print(json.dumps([os.getcwd(), sys.argv[1:]]))\n')
            executable.chmod(0o755)
        dev.save(self.worktree, dev.new_state(self.worktree))
        for scope in ('server', 'front', 'ui'):
            with self.subTest(scope=scope):
                file = 'packages/twenty-' + scope + '/src/example test.spec.ts'
                args = SimpleNamespace(command='test', scope=scope, files=[file], reallocate_ports=False)
                with patch.object(dev, 'prepare'), patch.object(dev, 'report'):
                    dev.operate(self.worktree, args)
                cwd, arguments = json.loads((root / ('test-' + scope + '.log')).read_text())
                self.assertEqual(cwd, str(root))
                expected = (['run', '--root', 'packages/twenty-ui', '--project', 'unit']
                            if scope == 'ui' else
                            ['--config=packages/twenty-' + scope + '/jest.config.mjs',
                             '--runInBand', '--runTestsByPath'])
                self.assertEqual(arguments, expected + [file])

    def test_failed_check_restores_previously_running_stack(self):
        state = dev.new_state(self.worktree)
        state['api_process'] = dataclasses.asdict(dev.identity(os.getpid()))
        dev.save(self.worktree, state)
        args = SimpleNamespace(command='check', scope='front', files=[], reallocate_ports=False)
        def rebuild(worktree, manifest):
            manifest['api_process'] = None
        with patch.object(dev, 'alive', side_effect=bool), patch.object(dev, 'prepare', side_effect=rebuild), \
             patch.object(dev, 'task', side_effect=dev.Failure('compiler failed')), \
             patch.object(dev, 'start') as start:
            with self.assertRaisesRegex(dev.Failure, 'compiler failed'):
                dev.operate(self.worktree, args)
            start.assert_called_once()

    def test_port_reservations_include_stopped_worktrees(self):
        import hashlib
        states = self.worktree.root / 'states'
        states.mkdir()
        first_root = self.worktree.root / 'first'
        second_root = self.worktree.root / 'second'
        def worktree(root):
            key = hashlib.sha256(str(root).encode()).hexdigest()[:20]
            state_dir = states / key
            state_dir.mkdir()
            return dev.Worktree(root, key, state_dir, 'twenty-' + key)
        first, second = worktree(first_root), worktree(second_root)
        first_state = dev.reserve_ports(first)
        second_state = dev.reserve_ports(second)
        self.assertFalse(set(first_state['ports'].values()) & set(second_state['ports'].values()))
        self.assertEqual(dev.load(second), second_state)
        observed = []
        real_free_port = dev.free_port
        def record_exclusions(exclude):
            observed.append(set(exclude))
            return real_free_port(exclude)
        with patch.object(dev, 'free_port', side_effect=record_exclusions):
            dev.reserve_ports(second, second_state)
        self.assertTrue(set(first_state['ports'].values()).issubset(observed[0]))

    def test_prepare_accepts_owned_paths_and_rejects_external_symlinks(self):
        root = self.worktree.root
        (root / 'packages').mkdir()
        (root / 'owned-dependencies').mkdir()
        modules = root / 'node_modules'
        modules.symlink_to(root / 'owned-dependencies', target_is_directory=True)
        state = dev.new_state(self.worktree)
        with patch.object(dev, 'runtime_env', side_effect=dev.Failure('toolchain reached')):
            with self.assertRaisesRegex(dev.Failure, 'toolchain reached'):
                dev.prepare(self.worktree, state)
            modules.unlink()
            modules.symlink_to(root.parent, target_is_directory=True)
            with self.assertRaisesRegex(dev.Failure, 'must remain inside this worktree'):
                dev.prepare(self.worktree, state)

    def test_prepare_rejects_node_distribution_without_npx(self):
        (self.worktree.root / 'packages').mkdir()
        state = dev.new_state(self.worktree)
        with patch.object(dev.shutil, 'which', side_effect=lambda name, path: '/bin/' + name if name != 'npx' else None):
            with self.assertRaisesRegex(dev.Failure, 'Full Node 24 distribution with npm and npx is required; missing npx'):
                dev.prepare(self.worktree, state)

    def test_runtime_environment_avoids_conflicting_node_color_settings(self):
        with patch.dict(os.environ, {'NO_COLOR': '1', 'FORCE_COLOR': 'true'}, clear=True):
            env = dev.runtime_env()
            self.assertNotIn('NO_COLOR', env)
            self.assertNotIn('FORCE_COLOR', env)
            self.assertEqual(os.environ['NO_COLOR'], '1')

    def test_node_version_changes_dependency_and_build_fingerprints(self):
        subprocess.run(['git', 'init', '-q', str(self.worktree.root)], check=True)
        for dependencies in (True, False):
            self.assertNotEqual(dev.fingerprint(self.worktree, dependencies, 'v24.16.0'),
                                dev.fingerprint(self.worktree, dependencies, 'v24.21.0'))

    def test_private_phase_log_preserves_diagnostics_while_errors_are_redacted(self):
        log = self.worktree.state_dir / 'phase.log'
        with self.assertRaises(dev.Failure) as error:
            dev.run([sys.executable, '-c', "print('TokenClass failed'); print('useful failure'); raise SystemExit(1)"], log=log)
        self.assertIn('TokenClass failed', log.read_text())
        self.assertNotIn('TokenClass', str(error.exception))
        self.assertEqual(log.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
