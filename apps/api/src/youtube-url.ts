// A mesma identidade é usada no conector, cache e escopo das permissões.
export const youtubeHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
export function youtubeVideoId(url: URL): string | undefined {
  if (
    !youtubeHosts.has(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
  )
    return;
  const path = url.pathname.replace(/\/+$/, '');
  const id = ['youtu.be', 'www.youtu.be'].includes(url.hostname)
    ? path.match(/^\/([\w-]{11})$/)?.[1]
    : path === '/watch'
      ? (url.searchParams.get('v') ?? undefined)
      : path.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})$/)?.[1];
  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}
