// Only definitive missing responses authorize removal; network and permission failures do not.
export async function isMissingMenuImage({ objectRef, url, metadata, request }) {
  try {
    if (objectRef) {
      try { await metadata(objectRef) } catch (error) { return error.code === 'storage/object-not-found' }
      return false
    }
    const response = await request(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    return response.status === 404 || response.status === 410
  } catch { return false }
}
