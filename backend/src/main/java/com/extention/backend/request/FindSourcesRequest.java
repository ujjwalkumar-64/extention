package com.extention.backend.request;

import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class FindSourcesRequest {
    private String text;
    private String sourceUrl;
    private String persona;
    private Integer size;

}