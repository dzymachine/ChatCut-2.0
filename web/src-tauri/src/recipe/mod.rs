pub mod validator;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

// ─── Recipe AST Types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub nodes: Vec<RecipeNode>,
    pub connections: Vec<RecipeConnection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecipeNode {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(default)]
    pub params: HashMap<String, RecipeParamValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

impl RecipeNode {
    pub fn node_id(&self) -> &str {
        &self.id
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum RecipeParamValue {
    Number(f64),
    Text(String),
    Bool(bool),
}

impl std::fmt::Display for RecipeParamValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecipeParamValue::Number(n) => {
                let s = format!("{:.6}", n);
                write!(f, "{}", s.trim_end_matches('0').trim_end_matches('.'))
            }
            RecipeParamValue::Text(s) => write!(f, "{}", s),
            RecipeParamValue::Bool(b) => write!(f, "{}", if *b { 1 } else { 0 }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecipeConnection {
    pub from: String,
    pub to: String,
}

// ─── Compiler ─────────────────────────────────────────────────────────────────

/// Compile a Recipe AST into an FFmpeg filter chain string.
///
/// Walks the nodes in topological order (determined by `connections`)
/// and emits `filter=param=value:param=value` per structured node,
/// or the literal string for raw nodes.  Nodes are joined with `,`.
pub fn compile_recipe(recipe: &Recipe) -> Result<String, String> {
    let order = topological_sort(recipe)?;

    let node_map: HashMap<&str, &RecipeNode> = recipe
        .nodes
        .iter()
        .map(|n| (n.node_id(), n))
        .collect();

    let mut filters: Vec<String> = Vec::new();

    for node_id in &order {
        let node = node_map
            .get(node_id.as_str())
            .ok_or_else(|| format!("Node referenced in connections but not defined: {}", node_id))?;

        if let Some(raw) = &node.raw {
            filters.push(raw.clone());
        } else if let Some(filter) = &node.filter {
            if node.params.is_empty() {
                filters.push(filter.clone());
            } else {
                let param_parts: Vec<String> = node
                    .params
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect();
                filters.push(format!("{}={}", filter, param_parts.join(":")));
            }
        }
    }

    Ok(filters.join(","))
}

/// Topological sort of recipe nodes based on connections.
/// Returns node IDs in execution order (excludes "input" and "output" pseudo-nodes).
fn topological_sort(recipe: &Recipe) -> Result<Vec<String>, String> {
    let node_ids: HashSet<&str> = recipe.nodes.iter().map(|n| n.node_id()).collect();

    // Build adjacency list and in-degree count (only for real nodes)
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> = HashMap::new();

    for id in &node_ids {
        adj.entry(id).or_default();
        in_degree.entry(id).or_insert(0);
    }

    for conn in &recipe.connections {
        let from = conn.from.as_str();
        let to = conn.to.as_str();

        if from != "input" && !node_ids.contains(from) {
            return Err(format!("Connection references unknown node: {}", from));
        }
        if to != "output" && !node_ids.contains(to) {
            return Err(format!("Connection references unknown node: {}", to));
        }

        // Skip pseudo-nodes in the graph
        if from != "input" && to != "output" {
            adj.entry(from).or_default().push(to);
            *in_degree.entry(to).or_insert(0) += 1;
        } else if from == "input" && to != "output" {
            // "input" → node: node keeps its in_degree (already 0 from init)
        }
    }

    // Kahn's algorithm
    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut result: Vec<String> = Vec::new();

    while let Some(current) = queue.pop_front() {
        result.push(current.to_string());

        if let Some(neighbors) = adj.get(current) {
            for &next in neighbors {
                if let Some(deg) = in_degree.get_mut(next) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(next);
                    }
                }
            }
        }
    }

    if result.len() != node_ids.len() {
        return Err("Recipe contains a cycle".to_string());
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_linear_chain() {
        let recipe = Recipe {
            id: "test".to_string(),
            nodes: vec![
                RecipeNode {
                    id: "n1".to_string(),
                    filter: Some("eq".to_string()),
                    params: HashMap::from([
                        ("brightness".to_string(), RecipeParamValue::Number(0.1)),
                        ("contrast".to_string(), RecipeParamValue::Number(1.2)),
                    ]),
                    raw: None,
                },
                RecipeNode {
                    id: "n2".to_string(),
                    filter: Some("hue".to_string()),
                    params: HashMap::from([
                        ("s".to_string(), RecipeParamValue::Number(0.5)),
                    ]),
                    raw: None,
                },
            ],
            connections: vec![
                RecipeConnection { from: "input".to_string(), to: "n1".to_string() },
                RecipeConnection { from: "n1".to_string(), to: "n2".to_string() },
                RecipeConnection { from: "n2".to_string(), to: "output".to_string() },
            ],
        };

        let result = compile_recipe(&recipe).unwrap();
        assert!(result.contains("eq="));
        assert!(result.contains("hue=s=0.5"));
        assert!(result.contains(','));
    }

    #[test]
    fn test_compile_raw_node() {
        let recipe = Recipe {
            id: "test".to_string(),
            nodes: vec![RecipeNode {
                id: "r1".to_string(),
                filter: None,
                params: HashMap::new(),
                raw: Some("colorchannelmixer=rr=0.393:rg=0.769".to_string()),
            }],
            connections: vec![
                RecipeConnection { from: "input".to_string(), to: "r1".to_string() },
                RecipeConnection { from: "r1".to_string(), to: "output".to_string() },
            ],
        };

        let result = compile_recipe(&recipe).unwrap();
        assert_eq!(result, "colorchannelmixer=rr=0.393:rg=0.769");
    }

    #[test]
    fn test_compile_no_params() {
        let recipe = Recipe {
            id: "test".to_string(),
            nodes: vec![RecipeNode {
                id: "n1".to_string(),
                filter: Some("hflip".to_string()),
                params: HashMap::new(),
                raw: None,
            }],
            connections: vec![
                RecipeConnection { from: "input".to_string(), to: "n1".to_string() },
                RecipeConnection { from: "n1".to_string(), to: "output".to_string() },
            ],
        };

        let result = compile_recipe(&recipe).unwrap();
        assert_eq!(result, "hflip");
    }

    #[test]
    fn test_cycle_detection() {
        let recipe = Recipe {
            id: "test".to_string(),
            nodes: vec![
                RecipeNode {
                    id: "a".to_string(),
                    filter: Some("eq".to_string()),
                    params: HashMap::new(),
                    raw: None,
                },
                RecipeNode {
                    id: "b".to_string(),
                    filter: Some("hue".to_string()),
                    params: HashMap::new(),
                    raw: None,
                },
            ],
            connections: vec![
                RecipeConnection { from: "a".to_string(), to: "b".to_string() },
                RecipeConnection { from: "b".to_string(), to: "a".to_string() },
            ],
        };

        assert!(compile_recipe(&recipe).is_err());
    }

    #[test]
    fn test_serde_structured_without_params() {
        let json = r#"{"id":"n1","filter":"hflip"}"#;
        let node: RecipeNode = serde_json::from_str(json).unwrap();
        assert_eq!(node.filter.as_deref(), Some("hflip"));
        assert!(node.params.is_empty());
        assert!(node.raw.is_none());
    }

    #[test]
    fn test_serde_raw_node() {
        let json = r#"{"id":"r1","raw":"eq=brightness=0.1"}"#;
        let node: RecipeNode = serde_json::from_str(json).unwrap();
        assert!(node.filter.is_none());
        assert_eq!(node.raw.as_deref(), Some("eq=brightness=0.1"));
    }
}
