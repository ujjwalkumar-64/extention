package com.extention.backend.utils;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

public final class AuthUserUtil {
    private AuthUserUtil() {}
    public static String requireUsername() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        System.out.println(auth);
        if (auth == null || auth.getName() == null) {
            throw new IllegalStateException("No authenticated user in context");
        }

        return auth.getName();
    }
}