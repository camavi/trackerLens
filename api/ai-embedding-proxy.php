<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method-not-allowed']);
    exit;
}

function tl_embedding_proxy_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$request = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($request)) {
    tl_embedding_proxy_response(['error' => 'invalid-json-body'], 400);
}

$endpoint = trim((string) ($request['endpoint'] ?? ''));
$body = $request['body'] ?? null;
if ($endpoint === '' || !is_array($body)) {
    tl_embedding_proxy_response(['error' => 'missing-endpoint-or-body'], 400);
}

$parts = parse_url($endpoint);
$scheme = strtolower((string) ($parts['scheme'] ?? ''));
$host = strtolower((string) ($parts['host'] ?? ''));
$port = (int) ($parts['port'] ?? 0);
$path = (string) ($parts['path'] ?? '');

$allowedHosts = ['127.0.0.1', 'localhost', '::1'];
$allowedPorts = [1234, 11434];
if (!in_array($scheme, ['http', 'https'], true) ||
    !in_array($host, $allowedHosts, true) ||
    ($port && !in_array($port, $allowedPorts, true)) ||
    !preg_match('#/(v1/embeddings|api/embeddings|api/embed)$#', $path)) {
    tl_embedding_proxy_response(['error' => 'endpoint-not-allowed'], 403);
}

$payload = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if ($payload === false) {
    tl_embedding_proxy_response(['error' => 'body-encode-failed'], 400);
}

if (function_exists('curl_init')) {
    $curl = curl_init($endpoint);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $raw = curl_exec($curl);
    $error = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($raw === false) {
        tl_embedding_proxy_response(['error' => $error ?: 'curl-error'], 502);
    }
    http_response_code($status ?: 200);
    echo $raw;
    exit;
}

$context = stream_context_create([
    'http' => [
        'method' => 'POST',
        'timeout' => 60,
        'ignore_errors' => true,
        'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
        'content' => $payload,
    ],
]);
$raw = @file_get_contents($endpoint, false, $context);
$status = 0;
foreach (($http_response_header ?? []) as $header) {
    if (preg_match('/^HTTP\/\S+\s+(\d+)/i', $header, $match)) {
        $status = (int) $match[1];
        break;
    }
}
if ($raw === false) {
    tl_embedding_proxy_response(['error' => 'stream-fetch-failed'], 502);
}
http_response_code($status ?: 200);
echo $raw;
