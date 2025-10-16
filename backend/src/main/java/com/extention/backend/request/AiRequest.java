package com.extention.backend.request;

import com.extention.backend.entity.Action;

public record AiRequest (
        String text,
        Action action,
        String targetLang
){
}
