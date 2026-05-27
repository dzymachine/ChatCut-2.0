use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

use super::probe::{self, FilterDetail, FilterInfo};
use crate::error::ChatCutError;

#[derive(Debug, Deserialize)]
struct CategoriesFile {
    categories: Vec<CategoryDef>,
}

#[derive(Debug, Deserialize)]
struct CategoryDef {
    id: String,
    name: String,
    filters: Vec<String>,
}

static CATEGORY_MAP: OnceLock<HashMap<String, (String, String)>> = OnceLock::new();

/// Build a filter_name → (category_id, category_name) map from the embedded JSON.
fn load_category_map() -> HashMap<String, (String, String)> {
    let json = include_str!("../../../src-shared/filter-categories.json");
    let file: CategoriesFile = serde_json::from_str(json).expect("filter-categories.json is invalid");

    let mut map = HashMap::new();
    for cat in &file.categories {
        for filter in &cat.filters {
            map.insert(filter.clone(), (cat.id.clone(), cat.name.clone()));
        }
    }
    map
}

fn category_map() -> &'static HashMap<String, (String, String)> {
    CATEGORY_MAP.get_or_init(load_category_map)
}

static FILTER_CACHE: OnceLock<Vec<FilterInfo>> = OnceLock::new();

fn cached_filters() -> Result<&'static Vec<FilterInfo>, ChatCutError> {
    if let Some(filters) = FILTER_CACHE.get() {
        return Ok(filters);
    }
    let filters = probe::probe_filters()?;
    Ok(FILTER_CACHE.get_or_init(|| filters))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySummary {
    pub id: String,
    pub name: String,
    pub filter_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSummary {
    pub name: String,
    pub io_type: String,
    pub description: String,
    pub category: String,
}

/// List all categories with their filter counts.
pub fn list_categories() -> Result<Vec<CategorySummary>, ChatCutError> {
    let filters = cached_filters()?;
    let cat_map = category_map();

    // Load category definitions for ordering
    let json = include_str!("../../../src-shared/filter-categories.json");
    let file: CategoriesFile = serde_json::from_str(json).expect("filter-categories.json is invalid");

    let mut result: Vec<CategorySummary> = Vec::new();
    let mut category_counts: HashMap<String, usize> = HashMap::new();

    for f in filters {
        let cat_id = cat_map
            .get(&f.name)
            .map(|(id, _)| id.as_str())
            .unwrap_or("other");
        *category_counts.entry(cat_id.to_string()).or_default() += 1;
    }

    for cat in &file.categories {
        let count = category_counts.remove(&cat.id).unwrap_or(0);
        if count > 0 {
            result.push(CategorySummary {
                id: cat.id.clone(),
                name: cat.name.clone(),
                filter_count: count,
            });
        }
    }

    // Add "Other" for uncategorized
    let other_count = category_counts.remove("other").unwrap_or(0);
    if other_count > 0 {
        result.push(CategorySummary {
            id: "other".to_string(),
            name: "Other".to_string(),
            filter_count: other_count,
        });
    }

    Ok(result)
}

/// List filters in a category, or search across all filters by keyword.
pub fn list_filters(category: Option<&str>, query: Option<&str>) -> Result<Vec<FilterSummary>, ChatCutError> {
    let filters = cached_filters()?;
    let cat_map = category_map();

    let query_lower = query.map(|q| q.to_lowercase());

    let mut result: Vec<FilterSummary> = Vec::new();

    for f in filters {
        let (cat_id, cat_name) = cat_map
            .get(&f.name)
            .cloned()
            .unwrap_or_else(|| ("other".to_string(), "Other".to_string()));

        // Filter by category if specified
        if let Some(target_cat) = category {
            if cat_id != target_cat {
                continue;
            }
        }

        // Filter by keyword if specified
        if let Some(ref q) = query_lower {
            if !f.name.to_lowercase().contains(q)
                && !f.description.to_lowercase().contains(q)
            {
                continue;
            }
        }

        result.push(FilterSummary {
            name: f.name.clone(),
            io_type: f.io_type.clone(),
            description: f.description.clone(),
            category: cat_name,
        });
    }

    Ok(result)
}

/// Get detailed info about a specific filter (parameters, defaults, ranges).
pub fn describe_filter(name: &str) -> Result<FilterDetail, ChatCutError> {
    probe::probe_filter_detail(name)
}
