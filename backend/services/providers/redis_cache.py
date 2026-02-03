"""
Redis-based TTL caching for Gemini API responses
Auto-configures with sensible defaults - no .env needed
"""
import os
import json
import hashlib
from typing import Dict, Any, Optional

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
    
    def set(self, prompt: str, response: Dict, context_params: Optional[Dict] = None) -> bool:
        """Store response in cache with TTL (silently fails if Redis unavailable)"""
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