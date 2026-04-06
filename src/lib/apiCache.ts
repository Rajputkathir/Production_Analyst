// Enhanced API cache with request deduplication and smart TTL
const cache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for static data

// In-flight request deduplication: prevents duplicate simultaneous fetches
const inFlight: Record<string, Promise<any>> = {};

export const getCachedData = (key: string) => {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
};

export const setCachedData = (key: string, data: any) => {
  cache[key] = {
    data,
    timestamp: Date.now()
  };
};

export const clearCache = (key?: string) => {
  if (key) {
    delete cache[key];
    delete inFlight[key];
  } else {
    Object.keys(cache).forEach(k => delete cache[k]);
    Object.keys(inFlight).forEach(k => delete inFlight[k]);
  }
};

/**
 * Deduplicated fetch: if a request with the same key is already in-flight,
 * returns the same promise rather than sending a duplicate HTTP request.
 */
export const dedupFetch = (key: string, fetcher: () => Promise<any>): Promise<any> => {
  const cached = getCachedData(key);
  if (cached !== null) return Promise.resolve(cached);

  if (inFlight[key]) return inFlight[key];

  const promise = fetcher().then(data => {
    setCachedData(key, data);
    delete inFlight[key];
    return data;
  }).catch(err => {
    delete inFlight[key];
    throw err;
  });

  inFlight[key] = promise;
  return promise;
};
