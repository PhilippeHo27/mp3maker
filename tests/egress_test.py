import importlib.util
import ipaddress
import pathlib
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).parents[1] / 'infra' / 'egress_proxy.py'
spec = importlib.util.spec_from_file_location('egress', MODULE)
egress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(egress)

class EgressTests(unittest.TestCase):
    def test_denies_private_metadata_loopback_and_reserved(self):
        for address in ['127.0.0.1', '169.254.169.254', '10.1.2.3', '172.16.0.1', '192.168.1.1', '100.100.100.100', '0.0.0.0', '224.0.0.1', '240.0.0.1']:
            with self.subTest(address=address):
                with patch.object(egress.socket, 'getaddrinfo', return_value=[(2,1,6,'',(address,443))]):
                    with self.assertRaises(ValueError): egress.resolve_public('target.example',443)

    def test_mixed_public_private_dns_answer_is_denied(self):
        with patch.object(egress.socket, 'getaddrinfo', return_value=[(2,1,6,'',('1.1.1.1',443)),(2,1,6,'',('10.0.0.1',443))]):
            with self.assertRaises(ValueError): egress.resolve_public('target.example',443)

    def test_returns_resolved_ip_not_hostname(self):
        with patch.object(egress.socket, 'getaddrinfo', return_value=[(2,1,6,'',('1.1.1.1',443))]):
            self.assertEqual(egress.resolve_public('target.example',443), [('1.1.1.1',443)])

    def test_connect_authority_restricts_ports_and_credentials(self):
        for target in ['localhost:3004','example.com:80','user@example.com:443','example.com:443/path','example.com:443?x=1','[::1]:443']:
            with self.subTest(target=target):
                with self.assertRaises(ValueError): egress.parse_authority(target)
        self.assertEqual(egress.parse_authority('www.youtube.com:443'), ('www.youtube.com',443))

if __name__ == '__main__': unittest.main()
