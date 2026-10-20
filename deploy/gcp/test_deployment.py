"""Offline deployment safety checks: no Google Cloud resources are created."""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "deploy" / "gcp"
PROJECT = "project-0a3017f8-3c64-4f72-86f"
REF = "1234567890abcdef1234567890abcdef12345678"

STUB = r'''#!/usr/bin/env python3
import json,os,pathlib,shlex,subprocess,sys
a=sys.argv[1:]; state=os.environ.get('ATTENDX_TEST_STATE','new')
with open(os.environ['ATTENDX_TEST_LOG'],'a') as f: f.write(json.dumps(a)+'\n')
if a[:2]==['auth','list']: print('test-owner@example.invalid')
elif a[:2]==['projects','describe']: print(a[2])
elif a[:3]==['compute','instances','describe']:
    if state=='existing': print(json.dumps({'labels':{'attendx-managed':'true'}}))
    elif state=='unrelated': print(json.dumps({'labels':{}}))
    else: sys.exit(1)
elif a[:3]==['compute','regions','describe']:
    print(json.dumps({'quotas':[{'metric':'CPUS','limit':2 if state=='quota' else 8,'usage':0},{'metric':'IN_USE_ADDRESSES','limit':2,'usage':0},{'metric':'PERSISTENT_DISKS_TOTAL_GB','limit':200,'usage':0}]}))
elif a[:2]==['compute','ssh'] and '--command' in a and os.environ.get('ATTENDX_TEST_RUNTIME_FILE'):
    parts=shlex.split(a[a.index('--command')+1])
    if parts[:2]==['sudo','/opt/attendx/app/deploy/gcp/admin.sh'] and parts[2] in ['set-origin','clear-origin']:
        origin=parts[3] if parts[2]=='set-origin' else ''
        subprocess.run(['bash','-c','source "$1"; set_runtime_origin "$2" "$3"','test',os.environ['ATTENDX_TEST_LIB'],os.environ['ATTENDX_TEST_RUNTIME_FILE'],origin],check=True)
elif 'describe' in a: sys.exit(1)
'''


class DeploymentChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="attendx-gcp-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        stub = self.directory / "gcloud"
        stub.write_text(STUB)
        stub.chmod(0o755)
        self.log = self.directory / "calls.jsonl"
        self.environment = dict(os.environ)
        self.environment.update(
            PATH=str(self.directory) + os.pathsep + os.environ["PATH"],
            ATTENDX_TEST_LOG=str(self.log),
        )

    def run_script(self, name, *arguments, state="new"):
        env = dict(self.environment, ATTENDX_TEST_STATE=state)
        return subprocess.run(
            ["bash", str(SCRIPTS / name), *arguments],
            text=True, capture_output=True, env=env, timeout=20,
        )

    def calls(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()] if self.log.exists() else []

    def deploy(self, *arguments, **options):
        return self.run_script("deploy.sh", "--project", PROJECT, "--ref", REF, *arguments, **options)

    def test_help_and_dry_run_do_not_call_gcloud(self):
        for arguments in [("--help",), ("--dry-run",)]:
            with self.subTest(arguments=arguments):
                result = self.deploy(*arguments)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.calls(), [])
        self.assertIn("35.235.240.0/20", result.stdout)
        self.assertIn("--no-service-account", result.stdout)
        self.assertNotIn("0.0.0.0/0", result.stdout)

    def test_invalid_identifiers_are_rejected_before_cloud_calls(self):
        invalid = [
            ("--project", "bad;touch /tmp/example"),
            ("--zone", "us-central1-a;false"),
            ("--name", "bad name"),
            ("--ref", "main"),
            ("--hours", "0"),
            ("--hours", "24"),
        ]
        for option, value in invalid:
            with self.subTest(option=option, value=value):
                result = self.deploy(option, value)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_creation_uses_private_iap_network_and_no_service_account(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        vm = next(x for x in calls if x[:3] == ["compute", "instances", "create"])
        self.assertIn("--no-service-account", vm)
        self.assertIn("--no-scopes", vm)
        self.assertEqual(vm[vm.index("--machine-type") + 1], "e2-standard-4")
        self.assertEqual(vm[vm.index("--boot-disk-size") + 1], "80GB")
        rule = next(x for x in calls if x[:3] == ["compute", "firewall-rules", "create"])
        self.assertEqual(rule[rule.index("--source-ranges") + 1], "35.235.240.0/20")
        self.assertEqual(rule[rule.index("--rules") + 1], "tcp:22")
        self.assertEqual(rule[rule.index("--target-tags") + 1], "attendx-office-iap")
        self.assertFalse(any("billing" in x for x in calls))

    def test_existing_managed_vm_is_not_replaced(self):
        result = self.deploy(state="existing")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("not replaced", result.stdout)
        self.assertFalse(any(x[:3] == ["compute", "instances", "create"] for x in self.calls()))

    def test_unrelated_vm_is_refused(self):
        result = self.deploy(state="unrelated")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrelated", result.stderr)
        self.assertFalse(any(x[:3] == ["compute", "instances", "create"] for x in self.calls()))

    def test_low_quota_does_not_create_resources_or_upgrade_machine(self):
        result = self.deploy(state="quota")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Insufficient", result.stderr)
        self.assertFalse(any("create" in x for x in self.calls()))

    def test_exact_preview_origin_validation_without_mutation(self):
        base = ("--project", PROJECT, "--dry-run", "--origin")
        result = self.run_script("access.sh", *base, "https://8080-test.cloudshell.dev")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("set-origin", result.stdout)
        self.assertIn("127.0.0.1:8080:127.0.0.1:8080", result.stdout)
        self.assertEqual(self.calls(), [])
        for origin in [
            "https://user:password@example.com", "https://example.com/path",
            "https://example.com?x=1", "https://example.com#x", "https://example.com:443",
            "http://example.com", "https://example.com;false",
        ]:
            with self.subTest(origin=origin):
                result = self.run_script("access.sh", *base, origin)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_preview_local_preview_transition_updates_actual_configuration(self):
        runtime = self.directory / "runtime.env"
        runtime.write_text("ATTENDX_MODEL=qwen2.5-coder:3b\nATTENDX_PUBLIC_ORIGIN=\n")
        self.environment.update(
            ATTENDX_TEST_RUNTIME_FILE=str(runtime),
            ATTENDX_TEST_LIB=str(SCRIPTS / "lib.sh"),
        )

        def origin():
            lines = runtime.read_text().splitlines()
            self.assertIn("ATTENDX_MODEL=qwen2.5-coder:3b", lines)
            values = [x.split("=", 1)[1] for x in lines if x.startswith("ATTENDX_PUBLIC_ORIGIN=")]
            self.assertEqual(len(values), 1)
            self.assertEqual(runtime.stat().st_mode & 0o777, 0o600)
            return values[0]

        first = "https://8080-first.cloudshell.dev"
        result = self.run_script("access.sh", "--project", PROJECT, "--origin", first)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(origin(), first)

        result = self.run_script("access.sh", "--project", PROJECT, "--local")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(origin(), "")

        second = "https://8080-second.cloudshell.dev"
        result = self.run_script("access.sh", "--project", PROJECT, "--origin", second)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(origin(), second)

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose required for resolved config check")
    def test_resolved_compose_keeps_models_private_and_limits_local_work(self):
        result = subprocess.run(
            ["docker", "compose", "-f", "compose.yaml", "-f", "compose.gcp.yaml", "config", "--format", "json"],
            cwd=ROOT, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        services = config["services"]
        for name in ["api", "runner", "ollama", "model-init"]:
            self.assertFalse(services[name].get("ports"), name)
        self.assertEqual(services["web"]["ports"][0]["host_ip"], "127.0.0.1")
        self.assertEqual(services["api"]["environment"]["ATTENDX_LOCAL_ONLY"], "true")
        self.assertEqual(services["api"]["environment"]["ATTENDX_WORKER_CONCURRENCY"], "1")
        self.assertEqual(services["ollama"]["environment"]["OLLAMA_NO_CLOUD"], "1")
        self.assertEqual(services["ollama"]["environment"]["OLLAMA_NUM_PARALLEL"], "1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
