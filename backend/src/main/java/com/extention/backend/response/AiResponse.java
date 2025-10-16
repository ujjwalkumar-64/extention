package com.extention.backend.response;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class AiResponse {
    private String result;
    private boolean fromLocal;
}
