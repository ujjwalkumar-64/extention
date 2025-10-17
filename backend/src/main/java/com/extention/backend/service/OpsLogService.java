package com.extention.backend.service;



import com.extention.backend.entity.OperationLog;

import java.util.List;
import java.util.Map;

public interface OpsLogService {
    OperationLog saveFromPayload(String username, Map<String, Object> payload);

    List<OperationLog> recentForUser(String username, int limit);
}
