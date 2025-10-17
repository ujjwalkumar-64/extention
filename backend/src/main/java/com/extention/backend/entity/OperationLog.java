package com.extention.backend.entity;



import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

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

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // Owner (authenticated principal if present; else "anonymousUser")
    @Column(nullable = false, length = 191)
    private String username;

    @Column(length = 1024)
    private String sourceUrl;

    @Column(length = 64)
    private String opType; // e.g., summarize, explain, translate, quick_proofread_replace

    @Column(length = 16)
    private String targetLang; // e.g., en, fr

    @Lob
    private String inputPreview; // first ~500 chars

    private Integer inputLength;

    @Lob
    private String outputPreview; // first ~500 chars

    private Integer outputLength;

    // Store the full payload as JSON text for audit/debugging (TEXT for portability)
    @Lob
    private String rawPayloadJson;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
}
