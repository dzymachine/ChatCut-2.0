"""
Redis-based TTL caching for Gemini API responses
Auto-configures with sensible defaults - no .env needed
"""
import os
import json
import hashlib
import numpy as np
import re
from typing import Dict, Any, Optional
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False


class RedisCache:
    """Redis cache with TTL support - works with zero configuration"""
    
    def __init__(self, redis_url: Optional[str] = None, ttl_seconds: int = 86400):
        """
        Initialize Redis cache with smart defaults
        
        Args:
            redis_url: Redis URL (optional, defaults to localhost:6379)
            ttl_seconds: Cache TTL (default: 24 hours)
        
        No .env required - just works!
        """
        # Smart defaults - try env var, then use localhost
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self.ttl_seconds = ttl_seconds
        self.client = None
        self.is_available = False
        self.stats = {
            "hits": 0,
            "misses": 0,
            "writes": 0,
            "errors": 0,
            "evictions": 0
        }

        self.similarity_threshold = 0.85  # Tunable cutoff
        self._local_cache = []  # In-memory cache for similarity matching
        self._max_local_cache_size = 100  # Keep 100 most recent prompts
        
        self._connect()
    
    def _connect(self) -> bool:
        """Attempt to connect to Redis - fails gracefully"""
        if not REDIS_AVAILABLE:
            print("[Redis] ℹ️  redis-py not installed (optional). Install with: pip install redis")
            return False
        
        try:
            self.client = redis.from_url(self.redis_url, decode_responses=True, socket_connect_timeout=2)
            self.client.ping()
            self.is_available = True
            print(f"[Redis] ✅ Connected to {self.redis_url}")
            return True
            
        except redis.ConnectionError:
            print(f"[Redis] ℹ️  Cannot connect to {self.redis_url}")
            print("[Redis]    (Redis optional - caching disabled. Start with: docker run -d -p 6379:6379 redis:latest)")
            self.is_available = False
            return False
        except Exception as e:
            print(f"[Redis] ℹ️  Cache unavailable: {type(e).__name__}")
            self.is_available = False
            return False
    
    def _get_cache_key(self, prompt: str, context_params: Optional[Dict] = None) -> str:
        """Generate cache key from prompt + context"""
        cache_input = f"{prompt}:{json.dumps(context_params or {}, sort_keys=True)}"
        hash_value = hashlib.md5(cache_input.encode()).hexdigest()
        return f"chatcut:gemini:{hash_value}"
    
    def get(self, prompt: str, context_params: Optional[Dict] = None) -> Optional[Dict]:
        """Retrieve cached response (returns None if not found or Redis unavailable)"""
        if not self.is_available or not self.client:
            return None
        
        try:
            cache_key = self._get_cache_key(prompt, context_params)
            cached_value = self.client.get(cache_key)
            
            if cached_value:
                self.stats["hits"] += 1
                result = json.loads(cached_value)
                print(f"[Cache] HIT ✓ ({self.stats['hits']} total)")
                return result
            else:
                self.stats["misses"] += 1
                return None
                
        except Exception as e:
            self.stats["errors"] += 1
            # Silently fail - cache is optional
            return None
        
    def preprocess_prompt(self, prompt: str):
        """
        Normalize a user prompt for caching/similarity.
        Returns: (normalized: str, has_negation: bool)
        """

        if not prompt:
            return "", False, [], []

        s = str(prompt)

        # 1) Normalize whitespace and case
        s = s.strip().lower()

        # 2) Expand common percent phrases: "170 percent" -> "170%"
        s = re.sub(r'(\d+(?:\.\d+)?)\s*percent(s)?', r'\1%', s)

        # 3) Remove polite/filler phrases (word boundaries)
        s = re.sub(r'\b(please|pls|thank you|thanks|could you|would you|hey|hi|hello)\b', ' ', s)

        # 4) Normalize common contractions (simple set)
        s = re.sub(r"\b(can't|cannot)\b", "cannot", s)
        s = re.sub(r"\b(don't|do not)\b", "do not", s)
        s = re.sub(r"\b(doesn't|does not)\b", "does not", s)
        s = re.sub(r"\b(i'm|i am)\b", "i am", s)

        # 5) Replace punctuation except % and digits/letters/spaces (keep '%' for numeric meaning)
        s = re.sub(r'[^0-9a-zA-Z%\s]', ' ', s)

        # 6) Collapse repeated whitespace
        s = re.sub(r'\s+', ' ', s).strip()

        # 7) Optional lightweight synonym normalization (domain-specific)
        #    Map obvious synonyms to canonical tokens to improve matching: e.g. "scale" -> "zoom"
        syn_map = {
            'scale': 'zoom',
            'zooming': 'zoom',
            'zoomed': 'zoom',
            'increase volume': 'volume up',
            'decrease volume': 'volume down',
            'brightness': 'exposure'
        }
        # apply simple token-level replace (word boundaries)
        for k, v in syn_map.items():
            s = re.sub(r'\b' + re.escape(k) + r'\b', v, s)
        print(f"[Cache] Preprocessed prompt: '{prompt}' -> '{s}'")
        return s
    
    def get_similar(self, prompt: str, context_params: Optional[Dict] = None) -> Optional[Dict]:
        """
        Find cached response for similar prompt using cosine similarity.
        Falls back to exact match if no similarity match found.
        """

        # Preprocess prompt for better matching
        normalized_prompt = self.preprocess_prompt(prompt)

        # Try exact match first (fastest)
        exact_hit = self.get(normalized_prompt, context_params)
        if exact_hit:
            print(f"[Cache] EXACT HIT")
            return exact_hit
        
        # Try semantic similarity
        if not self._local_cache or len(self._local_cache) < 2:
            print(f"[Cache] Not enough entries for similarity check (need at least 2)")
            return None
        
        try:
            # Extract prompts from local cache
            cached_prompts = [item["prompt"] for item in self._local_cache]
            all_prompts = cached_prompts + [normalized_prompt]
            
            # Compute TF-IDF vectors (uses word/character n-grams)
            vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 3), lowercase=True)
            tfidf_matrix = vectorizer.fit_transform(all_prompts)
            
            # Compare new prompt with all cached prompts
            similarities = cosine_similarity(tfidf_matrix[-1], tfidf_matrix[:-1])[0]
            print(f"[Cache] Similarities: {similarities}")
            
            # Find best match
            best_idx = np.argmax(similarities)
            best_similarity = similarities[best_idx]
            
            print(f"[Cache] Similarity check: {best_similarity:.2f} (threshold: {self.similarity_threshold})")
            
            if best_similarity >= self.similarity_threshold:
                best_prompt = cached_prompts[best_idx]
                print(f"[Cache] SEMANTIC HIT! '{prompt}' matches '{best_prompt}' ({best_similarity:.2f})")
                
                # Return cached response for the similar prompt
                return self._local_cache[best_idx]["response"]
            
            return None
            
        except Exception as e:
            print(f"[Cache] Similarity check error: {e}")
            return None
    
    def set(self, prompt: str, response: Dict, context_params: Optional[Dict] = None) -> bool:
        """Store response in Redis AND in local memory for similarity matching"""
        # Preprocess prompt for better matching
        normalized_prompt = self.preprocess_prompt(prompt)

        # Store in Redis
        redis_stored = self._redis_set(normalized_prompt, response, context_params)
        
        # Also store in local cache for similarity matching
        try:
            if len(self._local_cache) >= self._max_local_cache_size:
                self._local_cache.pop(0)  # Remove oldest
            
            self._local_cache.append({
                "prompt": normalized_prompt,
                "response": response,
                "context": context_params
            })
        except Exception as e:
            print(f"[Cache] Local cache write error: {e}")
        
        return redis_stored
    
    def _redis_set(self, prompt: str, response: Dict, context_params: Optional[Dict] = None) -> bool:
        """Actual Redis write (extracted to separate method)"""
        if not self.is_available or not self.client:
            return False
        try:
            cache_key = self._get_cache_key(prompt, context_params)
            serialized = json.dumps(response)
            self.client.setex(cache_key, self.ttl_seconds, serialized)
            self.stats["writes"] += 1
            return True
        except Exception as e:
            self.stats["errors"] += 1
            return False
    def delete(self, prompt: str, context_params: Optional[Dict] = None) -> bool:
        """Manually delete a cached entry"""
        if not self.is_available or not self.client:
            return False
        
        try:
            cache_key = self._get_cache_key(prompt, context_params)
            deleted = self.client.delete(cache_key)
            return bool(deleted)
        except Exception:
            return False
    
    def clear_all(self) -> bool:
        """Clear ALL ChatCut cache"""
        if not self.is_available or not self.client:
            return False
        
        try:
            pattern = "chatcut:gemini:*"
            keys = self.client.keys(pattern)
            
            if keys:
                deleted = self.client.delete(*keys)
                self.stats["evictions"] += deleted
                print(f"[Cache] Cleared {deleted} entries")
                return True
            return True
                
        except Exception as e:
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        total = self.stats["hits"] + self.stats["misses"]
        hit_rate = (self.stats["hits"] / total * 100) if total > 0 else 0
        
        return {
            "available": self.is_available,
            "hits": self.stats["hits"],
            "misses": self.stats["misses"],
            "hit_rate": f"{hit_rate:.1f}%",
            "total_requests": total,
            "writes": self.stats["writes"],
            "errors": self.stats["errors"]
        }