// Tool Discovery — Scripts > Background fallback (Global scope)
// Use when ServiceNow MCP is not authenticated.
// Replace KEYWORDS with search terms that match the agent's capabilities.
(function() {
    var keywords = ['<keyword1>', '<keyword2>'];
    var results = { tools: [], subflows: [], actions: [], capabilities: [], catalogItems: [], topics: [], agents: [], scriptIncludes: [] };

    for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k];

        var tool = new GlideRecord('sn_aia_tool');
        tool.addEncodedQuery('descriptionLIKE' + kw + '^ORnameLIKE' + kw);
        tool.setLimit(20); tool.query();
        while (tool.next()) results.tools.push({ sys_id: tool.getUniqueValue(), name: tool.getValue('name'), type: tool.getValue('type'), scope: tool.getValue('sys_scope') });

        var flow = new GlideRecord('sys_hub_flow');
        flow.addEncodedQuery('descriptionLIKE' + kw + '^ORnameLIKE' + kw + '^active=true');
        flow.setLimit(20); flow.query();
        while (flow.next()) results.subflows.push({ sys_id: flow.getUniqueValue(), name: flow.getValue('name'), scope: flow.getValue('sys_scope') });

        var action = new GlideRecord('sys_hub_action_type_definition');
        action.addEncodedQuery('descriptionLIKE' + kw + '^ORnameLIKE' + kw + '^active=true');
        action.setLimit(20); action.query();
        while (action.next()) results.actions.push({ sys_id: action.getUniqueValue(), name: action.getValue('name'), scope: action.getValue('sys_scope') });

        var cap = new GlideRecord('sn_nowassist_skill_config');
        cap.addEncodedQuery('nameLIKE' + kw + '^ORdescriptionLIKE' + kw);
        cap.setLimit(20); cap.query();
        while (cap.next()) results.capabilities.push({ sys_id: cap.getUniqueValue(), name: cap.getValue('name'), scope: cap.getValue('sys_scope') });

        var cat = new GlideRecord('sc_cat_item');
        cat.addEncodedQuery('(nameLIKE' + kw + '^ORshort_descriptionLIKE' + kw + ')^active=true');
        cat.setLimit(20); cat.query();
        while (cat.next()) results.catalogItems.push({ sys_id: cat.getUniqueValue(), name: cat.getValue('name'), scope: cat.getValue('sys_scope') });

        var topic = new GlideRecord('sys_cs_topic');
        topic.addEncodedQuery('(nameLIKE' + kw + '^ORdescriptionLIKE' + kw + ')^active=true');
        topic.setLimit(20); topic.query();
        while (topic.next()) results.topics.push({ sys_id: topic.getUniqueValue(), name: topic.getValue('name'), type: topic.getValue('type'), scope: topic.getValue('sys_scope') });

        var agent = new GlideRecord('sn_aia_agent');
        agent.addEncodedQuery('descriptionLIKE' + kw + '^ORnameLIKE' + kw);
        agent.setLimit(10); agent.query();
        while (agent.next()) results.agents.push({ sys_id: agent.getUniqueValue(), name: agent.getValue('name'), scope: agent.getValue('sys_scope') });

        var si = new GlideRecord('sys_script_include');
        si.addEncodedQuery('nameLIKE' + kw + '^ORdescriptionLIKE' + kw + '^active=true');
        si.setLimit(20); si.query();
        while (si.next()) results.scriptIncludes.push({ sys_id: si.getUniqueValue(), name: si.getValue('name'), api_name: si.getValue('api_name'), access: si.getValue('access'), scope: si.getValue('sys_scope') });
    }

    function dedup(arr) {
        var seen = {};
        return arr.filter(function(item) { if (seen[item.sys_id]) return false; seen[item.sys_id] = true; return true; });
    }
    Object.keys(results).forEach(function(k) { results[k] = dedup(results[k]); });
    gs.info('=== TOOL DISCOVERY === ' + JSON.stringify(results, null, 2));
})();
