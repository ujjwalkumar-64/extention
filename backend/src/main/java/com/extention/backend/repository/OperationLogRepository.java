package com.extention.backend.repository;


import com.extention.backend.entity.OperationLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OperationLogRepository extends JpaRepository<OperationLog, Long> {
    List<OperationLog> findTop100ByUsernameOrderByCreatedAtDesc(String username);
}