package com.extention.backend.request;


import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;

public record UserRequest(

        Long id,
        @NotNull (message = "fullName is required")
        String fullName,
        @Email(message = " username is not valid")
        @NotNull(message = "username is required")
        String username,
        @NotNull(message = "password is required")
        String password
) {


}
