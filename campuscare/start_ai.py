"""Run SmartCampus with a verified local vision model. No downloads are implicit."""
import argparse
import json
import os
import urllib.request


def check_model(endpoint, model):
    request = urllib.request.Request(endpoint.rstrip('/') + '/api/show',
        data=json.dumps({'model': model}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        details = json.load(response)
    if 'vision' not in details.get('capabilities', []):
        raise ValueError('The selected model does not advertise vision support. Use gemma3:4b.')
    return details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check model installation without starting the website.')
    args = parser.parse_args()
    os.environ.setdefault('CAMPUSCARE_OLLAMA_URL', 'http://127.0.0.1:11434')
    os.environ.setdefault('CAMPUSCARE_MODEL', 'gemma3:4b')
    endpoint, model = os.environ['CAMPUSCARE_OLLAMA_URL'], os.environ['CAMPUSCARE_MODEL']
    try:
        check_model(endpoint, model)
    except (OSError, ValueError, TypeError) as error:
        print(f'Local AI is not ready: {error}')
        print('Start Ollama, run: ollama pull gemma3:4b, then retry.')
        return 1
    print(f'Vision model ready: {model} at {endpoint}', flush=True)
    if not args.check:
        from backend import server
        server.main()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
