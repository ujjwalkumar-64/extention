package com.extention.backend.entity;



import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(
        name = "operation_logs",
        indexes = {
                @Index(name = "ix_operation_logs_username", columnList = "username"),
                @Index(name = "ix_operation_logs_created_at", columnList = "createdAt"),
                @Index(name = "ix_operation_logs_op_type", columnList = "opType")
        }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OperationLog {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 191)
    private String username;

    @Column(length = 1024)
    private String sourceUrl;

    @Column(length = 64)
    private String opType;

    @Column(length = 16)
    private String targetLang;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "TEXT")
    private String inputPreview;

    private Integer inputLength;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "TEXT")
    private String outputPreview;

    private Integer outputLength;

    // Full raw payload JSON as TEXT (not LOB)
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(columnDefinition = "TEXT")
    private String rawPayloadJson;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
}
