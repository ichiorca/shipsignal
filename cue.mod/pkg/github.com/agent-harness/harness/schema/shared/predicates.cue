package shared

// Match-predicates used across hook actions, authorizations, and sensor fireConditions.

#MatchPredicate: #PathMatch | #PathNotExists | #EventKindMatch | #ToolMatch | #ProvenanceMatch | #Conjunction | #Disjunction | #Negation

#PathMatch: {
	kind: "path-match"
	glob: string
}

#PathNotExists: {
	kind: "path-not-exists"
	path: string
}

#EventKindMatch: {
	kind:      "event-kind"
	eventKind: string
}

#ToolMatch: {
	kind: "tool-match"
	tool: string
}

#ProvenanceMatch: {
	kind:        "provenance-match"
	provenance:  string
	trustLevel?: "trusted" | "mixed" | "untrusted" | "derived"
}

#Conjunction: {
	kind:   "and"
	clauses: [...#MatchPredicate]
}

#Disjunction: {
	kind:   "or"
	clauses: [...#MatchPredicate]
}

#Negation: {
	kind:    "not"
	clause:  #MatchPredicate
}
